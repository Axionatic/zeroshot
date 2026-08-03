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

        with open(transcript_path, "r") as f:
            lines = f.readlines()

        # Search backward through last 20 lines for most recent Task tool_use
        for line in reversed(lines[-20:]):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Transcript format: {"type":"assistant","message":{"content":[...]}}
            content = None
            if entry.get("type") == "assistant":
                content = entry.get("message", {}).get("content", [])
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
                    desc = inp.get("description", "")
                    if desc:
                        return desc
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

    hook_event = input_data.get("hook_event_name", "")
    agent_id = input_data.get("agent_id", "")
    agent_type = input_data.get("agent_type", "")
    transcript_path = input_data.get("transcript_path", "")

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
        # Ensure parent directory exists
        os.makedirs(os.path.dirname(events_file), exist_ok=True)
        with open(events_file, "a") as f:
            f.write(json.dumps(event) + "\n")

    sys.exit(0)


if __name__ == "__main__":
    main()
