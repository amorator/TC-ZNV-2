from hashlib import md5
from os import path, mkdir


def hash_str(value: str) -> str:
    return md5(value.encode('utf-8')).hexdigest()


def make_dir(base: str, sub: str = '', leaf: str = '') -> None:

    def _ensure(dir_path: str) -> None:
        if not path.isdir(dir_path):
            mkdir(dir_path)

    _ensure(base)
    if sub:
        sub_path = path.join(base, sub)
        _ensure(sub_path)
        if leaf:
            _ensure(path.join(sub_path, leaf))
