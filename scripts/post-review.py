import json, os, subprocess

review = open("/tmp/review.txt").read()
title = os.environ.get("PR_TITLE", "unknown")
author = os.environ.get("PR_AUTHOR", "unknown")
url = os.environ.get("PR_URL", "#")
webhook = os.environ.get("DISCORD_WEBHOOK_URL", "")
repo = os.environ.get("GITHUB_REPOSITORY", "")
pr_number = os.environ.get("PR_NUMBER", "")

# Post review as PR comment on GitHub (primary channel)
github_ok = False
if repo and pr_number:
    gh_token = os.environ.get("GH_TOKEN", "")
    if gh_token:
        comment_body = f"## 🤖 Hermes Agent Review\n\n{review}"
        comment_payload = json.dumps({"body": comment_body})
        try:
            result = subprocess.run([
                "curl", "-s", "-X", "POST",
                f"https://api.github.com/repos/{repo}/issues/{pr_number}/comments",
                "-H", "Content-Type: application/json",
                "-H", f"Authorization: token {gh_token}",
                "-d", comment_payload
            ], capture_output=True, text=True)
            github_ok = result.returncode == 0
            if not github_ok:
                print(f"GitHub comment failed (exit {result.returncode}): {result.stderr[:300]}")
            else:
                print(f"GitHub comment posted: {result.stdout[:200]}")
        except Exception as e:
            print(f"GitHub comment error: {e}")
    else:
        print("GH_TOKEN not set — skipping GitHub comment")
else:
    print("GITHUB_REPOSITORY/PR_NUMBER not set — skipping GitHub comment")

# Optionally mirror to Discord (secondary channel; failures never mask GitHub)
if webhook:
    embed = {
        "title": f"PR Review: {title}",
        "url": url,
        "description": review[:4000],
        "color": 5814783,
        "author": {"name": author},
        "footer": {"text": "Hermes Agent - Auto Review"}
    }
    payload = json.dumps({"embeds": [embed]})
    try:
        result = subprocess.run([
            "curl", "-s", "-X", "POST", webhook,
            "-H", "Content-Type: application/json",
            "-d", payload
        ], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Discord mirror failed (exit {result.returncode}): {result.stderr[:300]}")
        else:
            print(f"Discord webhook response: {result.stdout[:200]}")
    except Exception as e:
        print(f"Discord mirror error: {e}")
else:
    print("DISCORD_WEBHOOK_URL not set — skipping Discord mirror")

if not github_ok and not webhook:
    raise SystemExit("Review was generated but could not be delivered to any channel")
