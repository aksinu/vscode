/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../../nls.js';
import { IClaudeService, IClaudeFileChangeSummaryItem } from '../../../../common/services/core/claude.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { ISCMService } from '../../../../../scm/common/scm.js';

/**
 * Git 커밋 기능 관리 매니저
 * 책임: 파일 변경사항 커밋, 커밋 메시지 자동 생성, Git 명령 실행
 */
export class GitCommitManager {

	constructor(
		private readonly claudeService: IClaudeService,
		private readonly scmService: ISCMService,
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

			const workspaceFolder = this.workspaceContextService.getWorkspace()?.folders?.[0];
			if (!workspaceFolder) {
				throw new Error('No workspace folder found');
			}
			const cwd = workspaceFolder.uri.fsPath;

			// 2. Git add . (child_process로 직접 실행)
			const addResult = await this.executeGitCommandViaTerminalWithOutput('git add .', cwd);
			if (!addResult.success) {
				throw new Error(`Git add failed: ${addResult.error}`);
			}

			// 3. Git commit (child_process로 직접 실행, 메시지 이스케이프)
			const escapedMessage = commitMessage.replace(/"/g, '\\"');
			const commitResult = await this.executeGitCommandViaTerminalWithOutput(`git commit -m "${escapedMessage}"`, cwd);
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
	 * 푸시할 커밋이 있는지 확인
	 */
	async hasPushableCommits(): Promise<boolean> {
		try {
			const workspaceFolder = this.workspaceContextService.getWorkspace()?.folders?.[0];
			if (!workspaceFolder) {
				return false;
			}
			const cwd = workspaceFolder.uri.fsPath;

			// upstream 브랜치가 있는지 먼저 확인
			const upstreamResult = await this.executeGitCommandViaTerminalWithOutput('git rev-parse --abbrev-ref --symbolic-full-name @{upstream}', cwd);
			if (upstreamResult.success && upstreamResult.output?.trim()) {
				// upstream이 있으면 비교
				const result = await this.executeGitCommandViaTerminalWithOutput('git rev-list --count @{upstream}..HEAD', cwd);
				const count = parseInt(result.output?.trim() || '0', 10);
				return count > 0;
			}

			// upstream이 없는 경우 → 로컬 커밋이 있으면 push 가능 (새 브랜치)
			const logResult = await this.executeGitCommandViaTerminalWithOutput('git log --oneline -1', cwd);
			return logResult.success && !!logResult.output?.trim();
		} catch {
			return false;
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
			const cwd = workspaceFolder.uri.fsPath;

			// child_process로 직접 push 실행 (네트워크 작업이므로 30초 타임아웃)
			const result = await this.executeGitCommandViaTerminalWithOutput('git push', cwd, 30000);
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
	 * Git 명령 실행 (출력 캡처 - child_process 사용)
	 */
	private executeGitCommandViaTerminalWithOutput(command: string, workingDirectory: string, timeoutMs: number = 10000): Promise<{ success: boolean; output?: string; error?: string }> {
		return new Promise((resolve) => {
			try {
				const { exec } = require('child_process') as typeof import('child_process');
				exec(command, { cwd: workingDirectory, timeout: timeoutMs }, (error, stdout, stderr) => {
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

}
