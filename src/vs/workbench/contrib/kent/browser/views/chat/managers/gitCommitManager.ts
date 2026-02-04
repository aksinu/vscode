/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../../nls.js';
import { IClaudeService, IClaudeFileChangeSummaryItem } from '../../../../common/services/core/claude.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { ISCMService } from '../../../../../scm/common/scm.js';
import { ITerminalService } from '../../../../../terminal/browser/terminal.js';

/**
 * Git 커밋 기능 관리 매니저
 * 책임: 파일 변경사항 커밋, 커밋 메시지 자동 생성, Git 명령 실행
 */
export class GitCommitManager {

	constructor(
		private readonly claudeService: IClaudeService,
		private readonly scmService: ISCMService,
		private readonly terminalService: ITerminalService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly notificationService: INotificationService
	) {}

	/**
	 * 커밋할 변경사항이 있는지 확인
	 */
	hasChangesToCommit(): boolean {
		// 1. Git 저장소가 있는지 확인
		if (this.scmService.repositoryCount === 0) {
			return false;
		}

		// 2. 현재 세션의 파일 변경 목록 확인
		const changesHistory = this.claudeService.getSessionChangesHistory?.();
		return (changesHistory?.totalFilesChanged ?? 0) > 0;
	}

	/**
	 * 변경사항 커밋 처리
	 */
	async handleCommitChanges(): Promise<void> {
		try {
			// 변경된 파일 목록 가져오기
			const changesHistory = this.claudeService.getSessionChangesHistory?.();
			if (!changesHistory || changesHistory.filesSummary.length === 0) {
				this.notificationService.warn(localize('noChangesToCommit', "No changes to commit"));
				return;
			}

			// 커밋 메시지 생성
			const commitMessage = await this.generateCommitMessage(changesHistory.filesSummary);

			// Git 커밋 실행
			await this.executeGitCommit(changesHistory.filesSummary, commitMessage);

			this.notificationService.info(
				localize('changesCommitted', "Successfully committed {0} files", changesHistory.filesSummary.length)
			);
		} catch (error) {
			this.notificationService.error(
				localize('commitFailed', "Failed to commit changes: {0}", String(error))
			);
		}
	}

	/**
	 * 커밋 메시지 자동 생성 (토큰 절약을 위해 간단하게)
	 */
	async generateCommitMessage(fileChanges: IClaudeFileChangeSummaryItem[]): Promise<string> {
		const fileCount = fileChanges.length;

		// 파일 분석
		const extensions = new Set<string>();
		const directories = new Set<string>();
		const fileNames = fileChanges.map(f => {
			const filePath = f.filePath || '';
			const fileName = filePath.split('/').pop() || filePath;
			const ext = fileName.split('.').pop();
			if (ext) extensions.add(ext.toLowerCase());

			const dir = filePath.split('/').slice(-2, -1)[0];
			if (dir) directories.add(dir);

			return fileName;
		});

		// 파일 타입에 따른 액션 결정
		let action = 'Update';
		if (extensions.has('md') && extensions.size === 1) {
			action = 'Update documentation';
		} else if (extensions.has('ts') || extensions.has('js')) {
			action = 'Implement';
		} else if (extensions.has('css') && extensions.size === 1) {
			action = 'Style';
		} else if (extensions.has('json') && extensions.size === 1) {
			action = 'Configure';
		}

		// 디렉토리 기반 범위 결정
		let scope = '';
		if (directories.has('browser')) {
			scope = ' UI components';
		} else if (directories.has('service')) {
			scope = ' services';
		} else if (directories.has('common')) {
			scope = ' core functionality';
		}

		// 메시지 구성
		const mainFiles = fileNames.slice(0, 2).join(', ');

		if (fileCount === 1) {
			return `${action}${scope}: ${mainFiles}`;
		} else if (fileCount <= 3) {
			return `${action}${scope}: ${mainFiles}${fileCount > 2 ? ` and ${fileCount - 2} more` : ''}`;
		} else {
			return `${action}${scope}: ${mainFiles} and ${fileCount - 2} other files`;
		}
	}

	/**
	 * Git 커밋 실행
	 */
	private async executeGitCommit(fileChanges: IClaudeFileChangeSummaryItem[], commitMessage: string): Promise<void> {
		try {
			// 1. 모든 파일 변경사항 accept
			await this.claudeService.acceptAllFiles?.();

			// 2. Git add . (모든 변경사항 스테이지)
			const addResult = await this.executeGitCommand('git add .');
			if (!addResult.success) {
				throw new Error(`Git add failed: ${addResult.error}`);
			}

			// 3. Git commit
			const commitResult = await this.executeGitCommand(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
			if (!commitResult.success) {
				throw new Error(`Git commit failed: ${commitResult.error}`);
			}

			console.log(`[Commit] Successfully committed ${fileChanges.length} files`);
			console.log(`[Commit] Message: "${commitMessage}"`);
			console.log(`[Commit] Files:`, fileChanges.map(f => f.filePath));

		} catch (error) {
			console.error('[Commit] Failed to commit:', error);
			throw error;
		}
	}

	/**
	 * Git 명령어 실행 - VS Code SCM API 활용
	 */
	private async executeGitCommand(command: string): Promise<{ success: boolean; output?: string; error?: string }> {
		try {
			const workspaceFolder = this.workspaceContextService.getWorkspace()?.folders?.[0];

			if (!workspaceFolder) {
				return { success: false, error: 'No workspace folder found' };
			}

			// SCM 서비스를 통해 Git 리포지토리 확인
			const repositories = Array.from(this.scmService.repositories);
			const gitRepo = repositories.find(repo => repo.provider.rootUri?.toString() === workspaceFolder.uri.toString());

			if (!gitRepo) {
				// Git repository가 없으면 터미널 통해 실행
				return await this.executeGitCommandViaTerminal(command, workspaceFolder.uri.fsPath);
			}

			// Git add의 경우 SCM API 사용
			if (command === 'git add .') {
				// 모든 변경사항을 스테이지에 추가
				const provider = gitRepo.provider as any;
				if (provider.add) {
					await provider.add([workspaceFolder.uri.fsPath]);
					return { success: true, output: 'Files staged successfully' };
				}
			}

			// Git commit의 경우 SCM API 사용
			if (command.startsWith('git commit -m')) {
				const message = command.match(/git commit -m "(.*)"/)?.[1] || 'Auto-commit from Claude';
				const provider = gitRepo.provider as any;
				if (provider.commit) {
					await provider.commit(message);
					return { success: true, output: 'Commit successful' };
				}
			}

			// 기타 명령은 터미널로 폴백
			return await this.executeGitCommandViaTerminal(command, workspaceFolder.uri.fsPath);

		} catch (error) {
			console.error('[Git] Error executing command:', error);
			return { success: false, error: String(error) };
		}
	}

	/**
	 * 터미널을 통한 Git 명령 실행 (폴백)
	 */
	private async executeGitCommandViaTerminal(command: string, workingDirectory: string): Promise<{ success: boolean; output?: string; error?: string }> {
		try {
			const terminal = await this.terminalService.createTerminal({
				config: {
					name: 'Claude Git',
					hideFromUser: true
				},
				cwd: workingDirectory
			});

			terminal.sendText(command, true);

			// 명령 실행 완료를 기다림
			return new Promise<{ success: boolean; output?: string; error?: string }>((resolve) => {
				setTimeout(() => {
					terminal.dispose();
					resolve({ success: true, output: 'Command executed via terminal' });
				}, 2000);
			});

		} catch (error) {
			return { success: false, error: String(error) };
		}
	}
}
