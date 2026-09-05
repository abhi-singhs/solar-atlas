import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('disables bytecode before Blender imports and propagates the guard to child processes', () => {
  const result = execFileSync('python3', ['-c', `
import ast
import os
from pathlib import Path
import runpy
import sys
from unittest.mock import patch

for filename in ("export_blender.py", "prepare_assets.py"):
    path = Path("scripts") / filename
    tree = ast.parse(path.read_text(), filename=str(path))
    guarded = False
    for node in tree.body:
        if isinstance(node, ast.Assign):
            guarded = guarded or any(
                isinstance(target, ast.Attribute)
                and isinstance(target.value, ast.Name)
                and target.value.id == "sys"
                and target.attr == "dont_write_bytecode"
                and isinstance(node.value, ast.Constant)
                and node.value.value is True
                for target in node.targets
            )
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imported = node.module if isinstance(node, ast.ImportFrom) else node.names[0].name
            assert imported == "sys" or guarded, (filename, imported)
    assert guarded

module = runpy.run_path("scripts/prepare_assets.py", run_name="asset_guard_test")
assert sys.dont_write_bytecode is True
with patch.object(sys, "argv", ["scripts/prepare_assets.py"]), patch("subprocess.run") as child:
    module["main"]()
    child.assert_called_once()
    assert child.call_args.kwargs["env"]["PYTHONDONTWRITEBYTECODE"] == "1"
    assert child.call_args.kwargs["env"].get("PATH") == os.environ.get("PATH")
    assert "--inside-blender" in child.call_args.args[0]
print("Bytecode guard verified without running Blender or touching source files")
`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  expect(result).toContain('Bytecode guard verified')
})
