# skills

My personal agent skills. Small, readable, meant to be copied and changed.

## The skills

### `/wtf`

Explains something from the project you are in, in plain words, on a page.

![A /wtf run: the question, the agents reading, the page opening, a follow-up](media/wtf.gif)

You ask a question about your codebase. Several agents read the code, the notes and the
history in parallel. The answer opens in the browser as one page of diagrams, each with
numbered notes. Ask a follow-up and the same page grows a new section.

Details, requirements and the list of files: [`skills/wtf/README.md`](skills/wtf/README.md).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/vtemian/skills/main/install.sh | bash
```

It asks which skills you want, then links them into `~/.claude/skills`. The repo is cloned
to `~/.local/share/vtemian-skills`. Run it again to update or to add a skill. It asks before
it replaces a skill you already have under the same name.

To keep the repo somewhere else, clone it and run the same script from there:

```bash
git clone https://github.com/vtemian/skills.git
cd skills
./install.sh
```

Each skill is a folder with a `SKILL.md`, a `README.md` and a `scripts/` folder. `SKILL.md`
calls its scripts at `~/.claude/skills/<name>/scripts/`, which is why they are linked there.

## Tests

```bash
node --test tests/
```

The tests build real pages with each skill's own scripts, open them in a headless Chrome
and check what a reader would see: every diagram drawn and visible, every card on its box,
the notes, hover, click and step-through. They also run the installer in a terminal. They
need Node 22 or newer and Chrome, and install nothing. The pages and a picture of each are
left in `tests/out/`.

GitHub Actions runs them on every push, on Linux and on macOS.

## License

MIT
