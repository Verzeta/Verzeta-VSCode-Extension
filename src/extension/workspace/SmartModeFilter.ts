// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * SmartModeFilter — the seven-rule write decider behind the `smart`
 * permission tier (and the always-on `block` gate for every tier).
 *
 * Each rule returns `pass`, `ambiguous`, or `block`; the composite
 * verdict matrix is:
 *
 *   | tier   | all pass   | any ambiguous | any block   |
 *   | ask    | ask_user   | ask_user      | auto_reject |
 *   | smart  | auto_apply | ask_user      | auto_reject |
 *   | bypass | auto_apply | auto_apply    | auto_reject |
 *
 * Pure module — no vscode imports — so the rule battery is unit-
 * testable. The authoritative rule text lives in the project's
 * smart-mode rules standard and is reviewed before every release.
 */

import type { PermissionTier } from '../../shared/wire-types.js';

export type RuleVerdict = 'pass' | 'ambiguous' | 'block';

export interface RuleResult {
    readonly rule: string;
    readonly verdict: RuleVerdict;
    readonly reason: string;
}

export type CompositeVerdict = 'auto_apply' | 'ask_user' | 'auto_reject';

export interface SmartModeConfig {
    /** Extension allowlist including the leading dot (e.g. ".ts"). */
    readonly extensionAllowlist: readonly string[];
    /** Blocklist globs (client-side mirror of the host's L9 list). */
    readonly blocklistGlobs: readonly string[];
    /** Rule 3 threshold; payloads above it are ambiguous. */
    readonly maxFileBytes: number;
    /** Rule 4 threshold; diffs above it are ambiguous. */
    readonly maxDiffLines: number;
    /** Workspace .gitignore globs for Rule 6 (empty = rule passes). */
    readonly gitignoreGlobs: readonly string[];
}

export interface WriteCandidate {
    readonly relPath: string;
    readonly proposedContent: string;
    /** Current file content, undefined when the file is new. */
    readonly currentContent: string | undefined;
}

/** Basenames allowed without an extension (Rule 1). */
const ALLOWED_BASENAMES = new Set([
    'Dockerfile',
    'Makefile',
    'Rakefile',
    'Gemfile',
    'Brewfile',
    'Procfile',
    'Vagrantfile',
    'Jenkinsfile',
    'Caddyfile',
    'README',
    'LICENSE',
    'NOTICE',
    'CHANGELOG',
    'AUTHORS',
    'CONTRIBUTORS',
    'COPYING',
    'INSTALL',
    'THANKS',
]);

/** Rule 5 — suspicious content patterns; a hit blocks in EVERY tier. */
const SUSPICIOUS_PATTERNS: readonly { readonly label: string; readonly re: RegExp }[] = [
    // 5.1 shell-pipe-to-interpreter
    { label: 'pipe-to-shell', re: /(?:curl|wget)\s+[^|;\n]+\|\s*(?:bash|sh|zsh|fish|ksh)\b/ },
    { label: 'pipe-to-interpreter', re: /(?:curl|wget)\s+[^|;\n]+\|\s*(?:python\d?|node|ruby)\b/ },
    // 5.2 encoded payload + eval
    { label: 'eval-atob', re: /(?:eval|exec|new\s+Function)\s*\(\s*atob\s*\(/ },
    { label: 'eval-base64-node', re: /eval\s*\(\s*Buffer\.from\([^)]*'base64'\)/ },
    {
        label: 'exec-base64-python',
        re: /base64\.(?:b64decode|decodebytes)\b[\s\S]{0,120}?\bexec\b/,
    },
    {
        label: 'iex-base64-powershell',
        re: /FromBase64String[\s\S]{0,120}?(?:Invoke-Expression|\biex\b)/i,
    },
    // 5.3 embedded credentials
    { label: 'aws-key', re: /AKIA[0-9A-Z]{16}/ },
    {
        label: 'private-key',
        re: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP|ENCRYPTED)?\s*PRIVATE\s+KEY-----/,
    },
    { label: 'ssh-pubkey-rsa', re: /ssh-rsa\s+AAAA[0-9A-Za-z+/]{200,}/ },
    { label: 'ssh-pubkey-ed25519', re: /ssh-ed25519\s+AAAA[0-9A-Za-z+/]{60,}/ },
    { label: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
    { label: 'github-pat', re: /(?:ghp|gho)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}/ },
    { label: 'gitlab-pat', re: /glpat-[A-Za-z0-9_-]{20}/ },
    { label: 'npm-token', re: /npm_[A-Za-z0-9]{36}/ },
    { label: 'stripe-key', re: /sk_live_[A-Za-z0-9]{24,}/ },
    { label: 'sendgrid-key', re: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
    // 5.4 privilege escalation
    { label: 'sudo-destructive', re: /\bsudo\s+(?:rm|chmod|chown|dd|mv)\b/ },
    { label: 'setuid-root', re: /\b(?:os|process)\.setuid\s*\(\s*0\s*\)/ },
    { label: 'win-privilege', re: /\b(?:RtlAdjustPrivilege|SeDebugPrivilege)\b/ },
    // 5.5 persistence
    { label: 'shell-startup-var', re: /(?:^|\n)\s*(?:PROMPT_COMMAND|BASH_ENV)\s*=/ },
    {
        label: 'service-persistence',
        re: /\b(?:crontab\s+-e|systemctl\s+(?:enable|start)|sc\.exe\s+create|schtasks\s+\/create|launchctl\s+load)\b/i,
    },
    { label: 'auth-files', re: /\b(?:authorized_keys|sudoers)\b/ },
    // 5.6 reverse shell
    { label: 'dev-tcp-shell', re: /\/dev\/tcp\/\d+\.\d+\.\d+\.\d+\/\d+/ },
    { label: 'netcat-exec', re: /\bn?cat?\s+-e\b/ },
    { label: 'meterpreter', re: /\bmeterpreter\b/i },
    // 5.7 VS Code surface tampering
    {
        label: 'vscode-settings-tamper',
        re: /"verzeta\.[a-zA-Z.]+"\s*:\s*"(?:bypass|disable|skip)"/,
    },
];

/** Minimal glob match supporting `**`, `*`, and `?` (mirrors the tree builder's semantics). */
function globToRegExp(glob: string): RegExp {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                out += '.*';
                i++;
                if (glob[i + 1] === '/') i++;
            } else {
                out += '[^/]*';
            }
        } else if (c === '?') {
            out += '[^/]';
        } else if (c !== undefined && '\\^$.|+()[]{}'.includes(c)) {
            out += `\\${c}`;
        } else {
            out += c;
        }
    }
    return new RegExp(`(?:^|/)${out}$|^${out}(?:/|$)`);
}

function matchesAnyGlob(relPath: string, globs: readonly string[]): string | undefined {
    for (const g of globs) {
        if (g.length === 0) continue;
        const normalized = g.startsWith('**/') ? g.slice(3) : g;
        if (globToRegExp(normalized).test(relPath)) return g;
    }
    return undefined;
}

/**
 * Approximate changed-line count: positional comparison plus the
 * length delta. Exact LCS is unnecessary — Rule 4 only needs "is
 * this a big edit", not a precise diff.
 */
function approximateChangedLines(before: string, after: string): number {
    const a = before.split('\n');
    const b = after.split('\n');
    const shared = Math.min(a.length, b.length);
    let changed = Math.abs(a.length - b.length);
    for (let i = 0; i < shared; i++) {
        if (a[i] !== b[i]) changed++;
    }
    return changed;
}

/** Run the full rule battery against one write candidate. */
export function evaluateRules(
    candidate: WriteCandidate,
    config: SmartModeConfig,
): readonly RuleResult[] {
    const results: RuleResult[] = [];
    const { relPath, proposedContent, currentContent } = candidate;

    // Rule 1 — extension allowlist.
    const basename = relPath.split('/').pop() ?? relPath;
    const dotIdx = basename.lastIndexOf('.');
    const ext = dotIdx > 0 ? basename.slice(dotIdx).toLowerCase() : '';
    if (ext.length > 0 && config.extensionAllowlist.some((e) => e.toLowerCase() === ext)) {
        results.push({ rule: 'extension-allowlist', verdict: 'pass', reason: '' });
    } else if (ext.length === 0 && ALLOWED_BASENAMES.has(basename)) {
        results.push({ rule: 'extension-allowlist', verdict: 'pass', reason: '' });
    } else {
        results.push({
            rule: 'extension-allowlist',
            verdict: 'block',
            reason: `'${basename}' is not on the smart-mode extension allowlist`,
        });
    }

    // Rule 2 — path blocklist (client-side mirror of the host gate).
    const blockedBy = matchesAnyGlob(relPath, config.blocklistGlobs);
    results.push(
        blockedBy === undefined
            ? { rule: 'path-blocklist', verdict: 'pass', reason: '' }
            : {
                  rule: 'path-blocklist',
                  verdict: 'block',
                  reason: `path matches blocklist glob '${blockedBy}'`,
              },
    );

    // Rule 3 — file-size sanity.
    const bytes = new TextEncoder().encode(proposedContent).length;
    results.push(
        bytes > config.maxFileBytes
            ? {
                  rule: 'file-size',
                  verdict: 'ambiguous',
                  reason: `payload is ${bytes} bytes (threshold ${config.maxFileBytes})`,
              }
            : { rule: 'file-size', verdict: 'pass', reason: '' },
    );

    // Rule 4 — diff-line sanity.
    if (currentContent === undefined) {
        const newLines = proposedContent.split('\n').length;
        results.push(
            newLines > 200
                ? {
                      rule: 'diff-lines',
                      verdict: 'ambiguous',
                      reason: `new file with ${newLines} lines`,
                  }
                : { rule: 'diff-lines', verdict: 'pass', reason: '' },
        );
    } else {
        const changed = approximateChangedLines(currentContent, proposedContent);
        results.push(
            changed > config.maxDiffLines
                ? {
                      rule: 'diff-lines',
                      verdict: 'ambiguous',
                      reason: `~${changed} lines changed (threshold ${config.maxDiffLines})`,
                  }
                : { rule: 'diff-lines', verdict: 'pass', reason: '' },
        );
    }

    // Rule 5 — suspicious content (always block).
    const hit = SUSPICIOUS_PATTERNS.find((p) => p.re.test(proposedContent));
    results.push(
        hit === undefined
            ? { rule: 'suspicious-content', verdict: 'pass', reason: '' }
            : {
                  rule: 'suspicious-content',
                  verdict: 'block',
                  reason: `suspicious content pattern '${hit.label}'`,
              },
    );

    // Rule 6 — outside-.gitignore heuristic.
    const ignoredBy = matchesAnyGlob(relPath, config.gitignoreGlobs);
    results.push(
        ignoredBy === undefined
            ? { rule: 'gitignore', verdict: 'pass', reason: '' }
            : {
                  rule: 'gitignore',
                  verdict: 'ambiguous',
                  reason: `path matches .gitignore pattern '${ignoredBy}', usually a build output`,
              },
    );

    // Rule 7 — single-file enforcement (V1 wire carries one path; stub pass).
    results.push({ rule: 'single-file', verdict: 'pass', reason: '' });

    return results;
}

/** Collapse rule results through the verdict matrix for a tier. */
export function decide(
    tier: PermissionTier,
    results: readonly RuleResult[],
): { readonly verdict: CompositeVerdict; readonly detail: string } {
    const block = results.find((r) => r.verdict === 'block');
    if (block !== undefined) return { verdict: 'auto_reject', detail: block.reason };
    const ambiguous = results.filter((r) => r.verdict === 'ambiguous');
    if (ambiguous.length > 0) {
        const detail = ambiguous.map((r) => r.reason).join('; ');
        return tier === 'bypass'
            ? { verdict: 'auto_apply', detail }
            : { verdict: 'ask_user', detail };
    }
    return tier === 'ask'
        ? { verdict: 'ask_user', detail: '' }
        : { verdict: 'auto_apply', detail: '' };
}

export function evaluateCommandSafety(command: string): {
    readonly blocked: boolean;
    readonly rule?: string;
} {
    const hit = SUSPICIOUS_PATTERNS.find((p) => p.re.test(command));
    return hit === undefined ? { blocked: false } : { blocked: true, rule: hit.label };
}
