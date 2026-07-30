#!/usr/bin/env python3
"""Download the fixed Kokoro candidate set with atomic checksum verification."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any, Callable, BinaryIO


EXPECTED_REPOSITORY = "hexgrad/Kokoro-82M"
EXPECTED_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
EXPECTED_PATHS = {
    "config.json",
    "kokoro-v1_0.pth",
    "voices/ef_dora.pt",
    "voices/em_alex.pt",
    "voices/em_santa.pt",
    "voices/af_heart.pt",
    "voices/af_bella.pt",
}


def validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("manifest schema version must be 1")
    if value.get("repository") != EXPECTED_REPOSITORY:
        raise ValueError("unexpected model repository")
    if value.get("revision") != EXPECTED_REVISION:
        raise ValueError("unexpected model revision")
    if value.get("license") != "Apache-2.0":
        raise ValueError("unexpected model license")
    files = value.get("files")
    if not isinstance(files, list):
        raise ValueError("manifest files must be an array")
    paths = set()
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("manifest file entry must be an object")
        path = item.get("path")
        pure_path = PurePosixPath(path) if isinstance(path, str) else None
        if (
            pure_path is None
            or pure_path.is_absolute()
            or ".." in pure_path.parts
            or str(pure_path) != path
        ):
            raise ValueError("manifest contains unsafe file path")
        if path in paths:
            raise ValueError("manifest contains duplicate file path")
        paths.add(path)
        if not isinstance(item.get("size"), int) or item["size"] <= 0:
            raise ValueError(f"{path}: invalid size")
        checksum = item.get("sha256")
        if not isinstance(checksum, str) or len(checksum) != 64:
            raise ValueError(f"{path}: invalid SHA-256")
    if paths != EXPECTED_PATHS:
        raise ValueError("manifest file set does not match candidate version 1")
    return value


def copy_and_hash(source: BinaryIO, destination: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with destination.open("xb") as output:
        while chunk := source.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    os.chmod(destination, 0o600)
    return size, digest.hexdigest()


def download_candidates(
    manifest: dict[str, Any],
    target: Path,
    opener: Callable[[str], BinaryIO] = urllib.request.urlopen,
) -> None:
    validate_manifest(manifest)
    staging = target.with_name(f"{target.name}.installing")
    if target.exists():
        raise FileExistsError(f"target already exists: {target}")
    if staging.exists():
        raise FileExistsError(f"staging target already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    try:
        for item in manifest["files"]:
            relative = Path(item["path"])
            destination = staging / relative
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            encoded_path = urllib.parse.quote(item["path"], safe="/")
            url = (
                f"https://huggingface.co/{manifest['repository']}/resolve/"
                f"{manifest['revision']}/{encoded_path}"
            )
            with opener(url) as source:
                size, checksum = copy_and_hash(source, destination)
            if size != item["size"]:
                raise ValueError(
                    f"{item['path']}: expected {item['size']} bytes; received {size}"
                )
            if checksum != item["sha256"]:
                raise ValueError(f"{item['path']}: SHA-256 mismatch")
            print(f"PASS: {item['path']} {size} bytes {checksum}")
        os.replace(staging, target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    args = parser.parse_args()
    with args.manifest.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    download_candidates(manifest, args.target)
    print(f"PASS: Verified Kokoro candidate set installed at {args.target}")


if __name__ == "__main__":
    main()
