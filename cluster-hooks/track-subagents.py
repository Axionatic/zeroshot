#!/usr/bin/env python3
"""
SubagentStart/SubagentStop hook for tracking Claude Code subagents in TUI.

Writes JSONL events to ZEROSHOT_SUBAGENT_EVENTS_FILE so SubagentTracker /
StatusFooter can display subagent activity under each parent agent.

Only activates when ZEROSHOT_TRACK_SUBAGENTS=1 (set by agent-task-executor).
"""

import json
import os
import sys
import time


def read_description_from_transcript(transcript_path):
    """Read the Task tool description from the transcript JSONL file."""
    try:
        # Sleep briefly to let transcript flush
        time.sleep(0.5)

        # Read backward until the final 20 JSONL records are available. This
        # keeps normal transcript reads independent of the full session size.
        chunks = []
        newline_count = 0
        with open(transcript_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            position = f.tell()
            while position > 0 and newline_count <= 20:
                read_size = min(8192, position)
                position -= read_size
                f.seek(position)
                chunk = f.read(read_size)
                chunks.append(chunk)
                newline_count += chunk.count(b"\n")

        lines = b"".join(reversed(chunks)).decode("utf-8", errors="replace").splitlines()[-20:]

        # A transcript can contain Task calls from parallel subagents. The hook
        # payload has no Task tool-use ID to correlate with a particular
        # subagent, so only use the transcript when it provides one candidate.
        descriptions = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue

            # Transcript format: {"type":"assistant","message":{"content":[...]}}
            content = None
            if entry.get("type") == "assistant":
                message = entry.get("message", {})
                if isinstance(message, dict):
                    content = message.get("content", [])
            elif isinstance(entry.get("content"), list):
                content = entry["content"]

            if not content or not isinstance(content, list):
                continue

            for item in content:
                if (
                    isinstance(item, dict)
                    and item.get("type") == "tool_use"
                    and item.get("name") in ("Agent", "Task")
                ):
                    inp = item.get("input", {})
                    if not isinstance(inp, dict):
                        continue
                    desc = inp.get("description", "")
                    if desc:
                        descriptions.append(desc)
        if len(descriptions) == 1:
            return descriptions[0]
    except (OSError, IOError):
        pass
    return None


def main():
    if os.environ.get("ZEROSHOT_TRACK_SUBAGENTS") != "1":
        sys.exit(0)

    events_file = os.environ.get("ZEROSHOT_SUBAGENT_EVENTS_FILE")
    if not events_file:
        sys.exit(0)

    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)
    if not isinstance(input_data, dict):
        sys.exit(0)

    hook_event = input_data.get("hook_event_name", "")
    agent_id = input_data.get("agent_id", "")
    agent_type = input_data.get("agent_type", "")
    transcript_path = input_data.get("transcript_path", "")

    if not isinstance(transcript_path, str):
        sys.exit(0)

    if not agent_id:
        sys.exit(0)

    event = None

    if hook_event == "SubagentStart":
        description = None
        if transcript_path:
            description = read_description_from_transcript(transcript_path)
        if not description:
            description = agent_type or "subagent"

        event = {
            "event": "start",
            "agent_id": agent_id,
            "agent_type": agent_type,
            "description": description,
            "ts": int(time.time() * 1000),
        }

    elif hook_event == "SubagentStop":
        event = {
            "event": "stop",
            "agent_id": agent_id,
            "agent_type": agent_type,
            "ts": int(time.time() * 1000),
        }

    if event:
        try:
            directory = os.path.dirname(events_file)
            if directory:
                os.makedirs(directory, mode=0o700, exist_ok=True)
                os.chmod(directory, 0o700)
            old_umask = os.umask(0o077)
            try:
                with open(events_file, "a") as f:
                    os.chmod(events_file, 0o600)
                    f.write(json.dumps(event) + "\n")
            finally:
                os.umask(old_umask)
        except (OSError, IOError):
            pass

    sys.exit(0)


if __name__ == "__main__":
    main()
