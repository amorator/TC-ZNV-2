"""Registrators support: URL templating and HTTP directory browsing."""

from typing import List, Tuple, Dict
import re
import urllib.request
import urllib.parse


TEMPLATE_MARKERS = ["<date>", "<user>", "<time>", "<type>", "<file>"]


class Registrator:
    def __init__(self, name: str, url_template: str, enabled: bool = True, rid: int | None = None):
        self.id = rid
        self.name = name
        self.url_template = url_template
        self.enabled = bool(enabled)

    def base_url(self) -> str:
        t = str(self.url_template or "")
        idx = t.find("<date>")
        if idx > 0:
            return t[: idx - 1] if t[idx - 1] == "/" else t[:idx]
        # Fallback: strip the last 5 segments
        parts = t.split("/")
        if len(parts) > 5:
            return "/".join(parts[:-5])
        return t

    def build_url(self, date: str = "", user: str = "", time_s: str = "", type_s: str = "", file_s: str = "") -> str:
        url = str(self.url_template or "")
        url = url.replace("<date>", urllib.parse.quote(date))
        url = url.replace("<user>", urllib.parse.quote(user))
        url = url.replace("<time>", urllib.parse.quote(time_s))
        url = url.replace("<type>", urllib.parse.quote(type_s))
        url = url.replace("<file>", urllib.parse.quote(file_s))
        return url


def parse_directory_listing(url: str) -> List[str]:
    """Fetch an HTTP directory listing and return entry names.

    The target servers expose index of folders; we parse anchors (href) and return names.
    """
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            html = resp.read().decode("utf-8", "ignore")
    except Exception:
        return []
    # Match href values in <a href="name/"> or files; exclude parent dirs
    names: List[str] = []
    for m in re.finditer(r"<a\s+href=\"([^\"]+)\"", html, flags=re.IGNORECASE):
        href = m.group(1)
        if href in ("../", "./"):  # parent/self
            continue
        # Normalize name: trim trailing slash
        name = href.rstrip("/")
        if not name:
            continue
        # Skip query links
        if name.startswith("?"):
            continue
        # Decode percent-encoding
        try:
            name = urllib.parse.unquote(name)
        except Exception:
            pass
        names.append(name)
    # Deduplicate and sort
    uniq = sorted({n for n in names})
    return uniq



