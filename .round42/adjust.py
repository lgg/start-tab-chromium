from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    content = target.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    target.write_text(content.replace(old, new), encoding="utf-8")


replace_once(
    "scripts/validate-self-hosted-ci.mjs",
    '''  "node scripts/run-round41-fixtures.mjs",
  "node scripts/validate-round41-static.mjs",
  "node scripts/run-round42-fixtures.mjs",
  "node scripts/validate-round42-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",
''',
    '''  "node scripts/run-round41-fixtures.mjs",
  "node scripts/validate-round41-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",
''',
)
replace_once(
    "scripts/validate-self-hosted-ci.mjs",
    'console.log("Self-hosted Windows CI validation passed");\n',
    '''await import("./run-round42-fixtures.mjs");
await import("./validate-round42-static.mjs");

console.log("Self-hosted Windows CI validation passed");
''',
)

replace_once(
    "scripts/validate-round42-static.mjs",
    '''for (const command of ["node scripts/run-round42-fixtures.mjs", "node scripts/validate-round42-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract must include ${command}`);
}
''',
    '''for (const command of ["node scripts/run-round42-fixtures.mjs", "node scripts/validate-round42-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
}
assert.ok(workflow.includes("node scripts/validate-self-hosted-ci.mjs"),
  "CI must execute the self-hosted contract that owns Round 42 validation");
assert.ok(selfHosted.includes('await import("./run-round42-fixtures.mjs")'),
  "The mandatory self-hosted contract must execute Round 42 fixtures");
assert.ok(selfHosted.includes('await import("./validate-round42-static.mjs")'),
  "The mandatory self-hosted contract must execute Round 42 static validation");
''',
)
replace_once(
    "scripts/validate-round42-static.mjs",
    '''for (const temporary of [".round42", "round42-source-export", "round42-apply"]) {
  assert.equal(fs.existsSync(path.join(root, temporary)), false, `Temporary audit artifact remained: ${temporary}`);
}
''',
    '''for (const temporary of [
  ".round42",
  ".github/workflows/round42-source-export.yml",
  ".github/workflows/round42-apply.yml",
]) {
  assert.equal(fs.existsSync(path.join(root, temporary)), false, `Temporary audit artifact remained: ${temporary}`);
}
''',
)

print("Round 42 workflow-safe CI adjustment completed")
