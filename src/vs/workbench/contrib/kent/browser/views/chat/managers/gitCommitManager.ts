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
	async handleCommitChanges(commitMessage: string): Promise<void> {
		try {
			// 변경된 파일 목록 가져오기
			const changesHistory = this.claudeService.getSessionChangesHistory?.();
			if (!changesHistory || changesHistory.filesSummary.length === 0) {
				this.notificationService.warn(localize('noChangesToCommit', "No changes to commit"));
				return;
			}

			// Git 커밋 실행
			await this.executeGitCommit(changesHistory.filesSummary, commitMessage);

			this.notificationService.info(
				localize('changesCommitted', "Committed: {0}", commitMessage)
			);
		} catch (error) {
			this.notificationService.error(
				localize('commitFailed', "Failed to commit changes: {0}", String(error))
			);
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
	 * 푸시할 커밋이 있는지 확인
	 */
	async hasPushableCommits(): Promise<boolean> {
		try {
			const workspaceFolder = this.workspaceContextService.getWorkspace()?.folders?.[0];
			if (!workspaceFolder) {
				return false;
			}

			const result = await this.executeGitCommandViaTerminalWithOutput('git log @{u}..HEAD --oneline', workspaceFolder.uri.fsPath);
			return result.success && !!result.output?.trim();
		} catch {
			// upstream이 없는 경우 등 → 로컬 커밋이 있는지만 확인
			try {
				const workspaceFolder = this.workspaceContextService.getWorkspace()?.folders?.[0];
				if (!workspaceFolder) { return false; }
				const result = await this.executeGitCommandViaTerminalWithOutput('git log --oneline -1', workspaceFolder.uri.fsPath);
				return result.success && !!result.output?.trim();
			} catch {
				return false;
			}
		}
	}

	/**
	 * Git push 실행
	 */
	async handlePush(): Promise<void> {
		try {
			const workspaceFolder = this.workspaceContextService.getWorkspace()?.folders?.[0];
			if (!workspaceFolder) {
				this.notificationService.error(localize('noWorkspace', "No workspace folder found"));
				return;
			}

			// SCM API로 push 시도
			const repositories = Array.from(this.scmService.repositories);
			const gitRepo = repositories.find(repo =>
				repo.provider.rootUri?.toString() === workspaceFolder.uri.toString()
			);

			if (gitRepo) {
				const provider = gitRepo.provider as any;
				if (provider.push) {
					await provider.push();
					this.notificationService.info(localize('pushSuccess', "Push completed successfully"));
					return;
				}
			}

			// 폴백: 터미널로 push
			const result = await this.executeGitCommandViaTerminal('git push', workspaceFolder.uri.fsPath);
			if (result.success) {
				this.notificationService.info(localize('pushSuccess', "Push completed successfully"));
			} else {
				throw new Error(result.error || 'Push failed');
			}
		} catch (error) {
			this.notificationService.error(
				localize('pushFailed', "Failed to push: {0}", String(error))
			);
			throw error;
		}
	}

	/**
	 * 터미널을 통한 Git 명령 실행 (출력 캡처 - child_process 사용)
	 */
	private executeGitCommandViaTerminalWithOutput(command: string, workingDirectory: string): Promise<{ success: boolean; output?: string; error?: string }> {
		return new Promise((resolve) => {
			try {
				const { exec } = require('child_process') as typeof import('child_process');
				exec(command, { cwd: workingDirectory, timeout: 5000 }, (error, stdout, stderr) => {
					if (error) {
						resolve({ success: false, error: stderr || error.message });
					} else {
						resolve({ success: true, output: stdout.trim() });
					}
				});
			} catch (error) {
				resolve({ success: false, error: String(error) });
			}
		});
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
