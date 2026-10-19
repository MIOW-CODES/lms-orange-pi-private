import json, os, subprocess

diff = open("/tmp/pr_diff.txt").read()
try:
    files = open("/tmp/pr_files.txt").read()
except Exception:
    files = "(file list unavailable)"
title = os.environ.get("PR_TITLE", "unknown")
author = os.environ.get("PR_AUTHOR", "unknown")
url = os.environ.get("PR_URL", "#")
api_key = os.environ.get("OPENCODE_API_KEY", "")

prompt = f"""You are a senior code reviewer. Review this pull request and provide:
1. **Summary** - What the PR does (1-2 sentences)
2. **Issues** - Bugs, security problems, or code smells (if any)
3. **Suggestions** - Improvements or best practices
4. **Rating** - LGTM, Minor issues, or Needs changes

Be concise and actionable.

IMPORTANT: The diff below may be truncated for length. The COMPLETE list of
files changed in this PR is provided. A file listed there IS part of the PR even
if its diff is not shown. Do NOT claim that a file, migration, import, or line is
"missing" or "broken" merely because it is absent from the truncated diff.
Only report issues directly visible in the provided diff; if you cannot see
enough to judge, say so instead of guessing.

Prefer substance over volume: if there are no material bugs or security issues,
say so and rate LGTM rather than inventing minor nits.

PR: {title}
Author: {author}
URL: {url}

Files changed in this PR:
{files}

Diff:
{diff}"""

payload = json.dumps({
    "model": "mimo-v2.5",
    "messages": [{"role": "user", "content": prompt}],
    "stream": False
})

# Write the payload to a file and use curl's @file form: passing a very large
# body as a command-line argument exceeds the OS ARG_MAX limit.
payload_path = "/tmp/pr_review_payload.json"
with open(payload_path, "w") as f:
    f.write(payload)

session_id = f"miow-pr-review-{os.environ.get('PR_NUMBER', 'na')}-{os.environ.get('GITHUB_RUN_ID', 'local')}"

result = subprocess.run([
    "curl", "-s", "-X", "POST",
    "https://opencode.ai/zen/go/v1/chat/completions",
    "-H", "Content-Type: application/json",
    "-H", f"Authorization: Bearer {api_key}",
    "-H", f"x-opencode-session: {session_id}",
    "-d", f"@{payload_path}"
], capture_output=True, text=True)

try:
    data = json.loads(result.stdout)
    review = data["choices"][0]["message"]["content"]
except Exception as e:
    review = f"Error generating review: {e}\n\nRaw response: {result.stdout[:500]}"

open("/tmp/review.txt", "w").write(review)
print("Review generated successfully")
