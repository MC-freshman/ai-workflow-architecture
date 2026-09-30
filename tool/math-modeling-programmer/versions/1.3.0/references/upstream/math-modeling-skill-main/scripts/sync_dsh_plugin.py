#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同步主仓库到 dsh-plugin 内置知识库。

主仓库（源）结构：
  SKILL.md  references/  assets/  tools/<子skill>/SKILL.md

内置知识库（目标）结构：
  dsh-plugin/math-modeling-agent/skills/math-modeling/
    SKILL.md  references/  assets/  tools/<子skill>/SKILL.md

同步规则：
  - SKILL.md、references/、assets/ 全量递归镜像（排除 __pycache__ 与 *.pyc）
  - tools/ 只同步各子 skill 的 SKILL.md（知识库按设计仅内置说明文档，
    可执行脚本由使用方按 tools/*/SKILL.md 指引自行准备）
  - 目标中源已删除的文件会被清理（避免知识库残留过期内容）
  - 默认 dry-run，只报告不修改；加 --apply 才真正写入

用法：
  python scripts/sync_dsh_plugin.py            # dry-run，报告差异
  python scripts/sync_dsh_plugin.py --apply    # 真正同步
"""
import argparse
import hashlib
import os
import shutil
import sys

# 强制 stdout/stderr 使用 UTF-8，避免在 GBK 终端乱码
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 脚本位于仓库根 scripts/，据此定位仓库根
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(REPO_ROOT)
DEFAULT_DST = os.path.join(REPO_ROOT, "dsh-plugin", "math-modeling-agent", "skills", "math-modeling")
SKILL_DIRS = ("references", "assets")
TOOL_SKILL_MD = "SKILL.md"


def file_hash(path: str) -> str:
    """按内容计算 SHA-256（忽略 mtime，防止 mtime 相同但内容变化的漏同步）"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def need_sync(src: str, dst: str) -> bool:
    """需要同步：目标缺失或内容哈希不一致"""
    if not os.path.exists(dst):
        return True
    return file_hash(src) != file_hash(dst)


def is_ignored(relpath: str) -> bool:
    """跳过 __pycache__ 目录与 .pyc 缓存文件"""
    return "__pycache__" in relpath.split(os.sep) or relpath.endswith(".pyc")


def mirror_tree(src_root: str, dst_root: str, apply: bool, dry_lines: list) -> None:
    """递归镜像 src_root 到 dst_root，删除目标中的过期文件"""
    if not os.path.isdir(src_root):
        return
    os.makedirs(dst_root, exist_ok=True)

    src_files = set()
    for dirpath, dirnames, filenames in os.walk(src_root):
        rel_dir = os.path.relpath(dirpath, src_root)
        dirnames[:] = [d for d in dirnames if not is_ignored(os.path.join(rel_dir, d))]
        for fn in filenames:
            rel = os.path.join(rel_dir, fn)
            if not is_ignored(rel):
                src_files.add(rel)

    # 删除目标中的过期文件
    for dirpath, dirnames, filenames in os.walk(dst_root):
        rel_dir = os.path.relpath(dirpath, dst_root)
        dirnames[:] = [d for d in dirnames if not is_ignored(os.path.join(rel_dir, d))]
        for fn in filenames:
            rel = os.path.join(rel_dir, fn)
            if is_ignored(rel):
                continue
            src = os.path.join(src_root, rel)
            dst = os.path.join(dst_root, rel)
            if not os.path.exists(src):
                dry_lines.append(f"  删除(过期): {os.path.relpath(dst, DEFAULT_DST)}")
                if apply:
                    os.remove(dst)

    # 复制/更新文件
    for rel in sorted(src_files):
        src = os.path.join(src_root, rel)
        dst = os.path.join(dst_root, rel)
        if not need_sync(src, dst):
            continue
        dry_lines.append(f"  复制/更新: {os.path.relpath(dst, DEFAULT_DST)}")
        if apply:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)


def sync_tools(src_tools: str, dst_tools: str, apply: bool, dry_lines: list) -> None:
    """同步 tools/ 下各子 skill 的 SKILL.md"""
    if not os.path.isdir(src_tools):
        return
    for sub in sorted(os.listdir(src_tools)):
        src_md = os.path.join(src_tools, sub, TOOL_SKILL_MD)
        if not os.path.isfile(src_md):
            continue
        dst_md = os.path.join(dst_tools, sub, TOOL_SKILL_MD)
        if not need_sync(src_md, dst_md):
            continue
        dry_lines.append(f"  复制/更新: {os.path.relpath(dst_md, DEFAULT_DST)}")
        if apply:
            os.makedirs(os.path.dirname(dst_md), exist_ok=True)
            shutil.copy2(src_md, dst_md)


def clean_root_strays(dst_root: str, keep: set, apply: bool, dry_lines: list) -> None:
    """清理目标根目录下不属于镜像清单的顶层条目"""
    if not os.path.isdir(dst_root):
        return
    for name in sorted(os.listdir(dst_root)):
        if name in keep:
            continue
        p = os.path.join(dst_root, name)
        dry_lines.append(f"  删除(过期): {os.path.relpath(p, DEFAULT_DST)}")
        if apply:
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.rmtree(p)
            else:
                os.remove(p)


def main() -> None:
    parser = argparse.ArgumentParser(description="同步主仓库到 dsh-plugin 内置知识库")
    parser.add_argument("--apply", action="store_true", help="真正写入（默认 dry-run）")
    args = parser.parse_args()

    src = DEFAULT_SRC
    dst = DEFAULT_DST
    print(f"源目录:   {src}")
    print(f"目标目录: {dst}")
    print("模式:     " + ("APPLY（写入）" if args.apply else "DRY-RUN（仅报告）"))
    print("-" * 60)

    dry_lines = []

    # 1. 根 SKILL.md 与使用指南
    src_md = os.path.join(src, "SKILL.md")
    dst_md = os.path.join(dst, "SKILL.md")
    src_guide = os.path.join(src, "使用指南.md")
    dst_guide = os.path.join(dst, "使用指南.md")
    if os.path.isfile(src_md):
        mirror_tree(os.path.join(src, "references"), os.path.join(dst, "references"), args.apply, dry_lines)
        mirror_tree(os.path.join(src, "assets"), os.path.join(dst, "assets"), args.apply, dry_lines)
        sync_tools(os.path.join(src, "tools"), os.path.join(dst, "tools"), args.apply, dry_lines)
        # 目标根目录只允许保留上述镜像目录与 SKILL.md/使用指南.md，清理其余过期条目
        clean_root_strays(dst, {"references", "assets", "tools", "SKILL.md", "使用指南.md"}, args.apply, dry_lines)
        if need_sync(src_md, dst_md):
            dry_lines.append(f"  复制/更新: {os.path.relpath(dst_md, DEFAULT_DST)}")
            if args.apply:
                os.makedirs(os.path.dirname(dst_md), exist_ok=True)
                shutil.copy2(src_md, dst_md)
        if need_sync(src_guide, dst_guide):
            dry_lines.append(f"  复制/更新: {os.path.relpath(dst_guide, DEFAULT_DST)}")
            if args.apply:
                os.makedirs(os.path.dirname(dst_guide), exist_ok=True)
                shutil.copy2(src_guide, dst_guide)
    if dry_lines:
        print("需要同步的文件：")
        for line in dry_lines:
            print(line)
        print(f"\n共 {len(dry_lines)} 项待同步。")
        if not args.apply:
            print("提示：加 --apply 才真正写入。")
    else:
        print("内置知识库与主仓库已一致，无需同步。")

    return 0 if dry_lines == [] or args.apply else 1


if __name__ == "__main__":
    sys.exit(main())
