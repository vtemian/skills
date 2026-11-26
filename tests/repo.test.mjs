// Tests that hold for every skill in the repo, and for install.sh.
//
//   node --test tests/*.test.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SKILLS = readdirSync(join(ROOT, 'skills'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)

describe('every skill', () => {
  test('there is at least one', () => {
    assert.ok(SKILLS.length > 0)
  })

  for (const name of SKILLS) {
    const folder = join(ROOT, 'skills', name)

    test(`${name}: has SKILL.md, README.md and scripts/`, () => {
      for (const part of ['SKILL.md', 'README.md', 'scripts']) {
        assert.ok(existsSync(join(folder, part)), `skills/${name}/${part} exists`)
      }
    })

    test(`${name}: SKILL.md starts with its name and a description`, () => {
      const head = readFileSync(join(folder, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---\n/)

      assert.ok(head, 'SKILL.md starts with a --- block')
      assert.equal(head[1].match(/^name: *(.+)$/m)?.[1], name, 'the name is the name of the folder')
      assert.ok((head[1].match(/^description: *(.+)$/m)?.[1] || '').length > 40, 'the description says when to use it')
    })

    test(`${name}: every script SKILL.md calls is there and can be run`, () => {
      const text = readFileSync(join(folder, 'SKILL.md'), 'utf8')
      const called = [...new Set([...text.matchAll(new RegExp(`~/\\.claude/skills/${name}/(scripts/[\\w./-]+)`, 'g'))].map(found => found[1]))]

      for (const path of called) {
        assert.ok(existsSync(join(folder, path)), `${path} exists`)
        assert.doesNotThrow(() => accessSync(join(folder, path), constants.X_OK), `${path} can be run`)
      }
      assert.doesNotMatch(text, new RegExp(`~/\\.claude/skills/${name}/(?!scripts/)\\w`), 'scripts are called from scripts/')
    })

    test(`${name}: the README says something the installer can show`, () => {
      const first = readFileSync(join(folder, 'README.md'), 'utf8').split('\n').find(line => line.trim() && !line.startsWith('#') && !line.startsWith('!['))

      assert.ok(first && first.length > 20)
    })
  }
})

// install.sh asks its questions on a terminal, so each run gets one (tests/terminal.py).
function install(keys, env) {
  const ran = spawnSync('python3', [join(HERE, 'terminal.py'), keys, 'bash', join(ROOT, 'install.sh')], { encoding: 'utf8', env: { ...process.env, ...env } })

  return { status: ran.status, printed: ran.stdout.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '') }
}

describe('install.sh', () => {
  const home = mkdtempSync(join(tmpdir(), 'skills-install-'))
  const env = { CLAUDE_SKILLS_DIR: join(home, 'skills'), VTEMIAN_SKILLS_HOME: join(home, 'clone') }
  const link = name => join(home, 'skills', name)

  test('lists every skill with a line about it, and enter links them', () => {
    const ran = install('enter', env)

    assert.equal(ran.status, 0, ran.printed)
    assert.match(ran.printed, /Which skills do you want\?/)
    for (const name of SKILLS) {
      assert.match(ran.printed, new RegExp(`\\[x\\] ${name}\\n`), `${name} is listed and picked`)
      assert.match(ran.printed, new RegExp(`ok {4}${name}: linked at `))
      assert.ok(lstatSync(link(name)).isSymbolicLink())
      assert.equal(readlinkSync(link(name)), join(ROOT, 'skills', name))
      assert.ok(existsSync(join(link(name), 'SKILL.md')), 'the link leads to the skill')
    }
    assert.match(ran.printed, /Explains something from the project you are in/)
  })

  test('run again, the skills are marked installed and nothing changes', () => {
    const ran = install('enter', env)

    assert.equal(ran.status, 0, ran.printed)
    assert.match(ran.printed, new RegExp(`\\[ \\] ${SKILLS[0]} \\(installed\\)`))
    assert.match(ran.printed, /Nothing installed\./)
  })

  test('q quits without installing', () => {
    const fresh = { ...env, CLAUDE_SKILLS_DIR: join(home, 'quit') }
    const ran = install('q', fresh)

    assert.equal(ran.status, 0, ran.printed)
    assert.match(ran.printed, /Nothing installed\./)
    assert.equal(existsSync(join(home, 'quit', SKILLS[0])), false)
  })

  test('space unpicks a skill', () => {
    const fresh = { ...env, CLAUDE_SKILLS_DIR: join(home, 'unpicked') }
    const ran = install('space,enter', fresh)

    assert.equal(existsSync(join(home, 'unpicked', SKILLS[0])), false, ran.printed)
  })

  test('it asks before it replaces a link that points somewhere else', () => {
    const fresh = { ...env, CLAUDE_SKILLS_DIR: join(home, 'other') }

    mkdirSync(join(home, 'other'))
    symlinkSync(tmpdir(), join(home, 'other', SKILLS[0]))

    const kept = install('enter,n,enter', fresh)

    assert.match(kept.printed, /Replace it\? \[y\/N\]/)
    assert.equal(readlinkSync(join(home, 'other', SKILLS[0])), tmpdir(), 'no leaves it as it was')

    const replaced = install('enter,y,enter', fresh)

    assert.match(replaced.printed, /link replaced/)
    assert.equal(readlinkSync(join(home, 'other', SKILLS[0])), join(ROOT, 'skills', SKILLS[0]))
  })

  test('it never touches a real folder with the name of a skill', () => {
    const fresh = { ...env, CLAUDE_SKILLS_DIR: join(home, 'folder') }

    mkdirSync(join(home, 'folder', SKILLS[0]), { recursive: true })
    const ran = install('enter', fresh)

    assert.equal(ran.status, 1, ran.printed)
    assert.match(ran.printed, /is a real folder/)
    assert.ok(lstatSync(join(home, 'folder', SKILLS[0])).isDirectory())
  })

  test('with no terminal it stops and says what to do', () => {
    const ran = spawnSync('bash', [join(ROOT, 'install.sh')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })

    assert.equal(ran.status, 2)
    assert.match(ran.stderr, /needs a terminal/)
  })

  test('cleanup', () => {
    rmSync(home, { recursive: true, force: true })
  })
})
