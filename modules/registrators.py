"""Registrators support: URL templating and HTTP directory browsing."""

from typing import List, Tuple, Dict
import re
import urllib.request
import urllib.parse


TEMPLATE_MARKERS = ["<date>", "<user>", "<time>", "<type>", "<file>"]


class Registrator:
	def __init__(self, name: str, url_template: str, local_folder: str = "", enabled: bool = True, rid: int | None = None):
		self.id = rid
		self.name = name
		# Normalize markers: support both <> and {} in url templates
		t = str(url_template or "")
		t = t.replace("{date}", "<date>")
		t = t.replace("{user}", "<user>")
		t = t.replace("{time}", "<time>")
		t = t.replace("{type}", "<type>")
		t = t.replace("{file}", "<file>")
		self.url_template = t
		self.enabled = bool(enabled)
		self.local_folder = local_folder or ""

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

	def build_partial_url(self, **kwargs) -> str:
		"""Build URL with only specified parameters, truncating at the next placeholder."""
		url = str(self.url_template or "")
		
		# Replace only the specified parameters
		if 'date' in kwargs:
			url = url.replace("<date>", urllib.parse.quote(kwargs['date']))
		if 'user' in kwargs:
			url = url.replace("<user>", urllib.parse.quote(kwargs['user']))
		if 'time' in kwargs:
			url = url.replace("<time>", urllib.parse.quote(kwargs['time']))
		if 'type' in kwargs:
			url = url.replace("<type>", urllib.parse.quote(kwargs['type']))
		if 'file' in kwargs:
			url = url.replace("<file>", urllib.parse.quote(kwargs['file']))
		
		# Find the first remaining placeholder and truncate there
		import re
		placeholder_pattern = r'<[^>]+>'
		match = re.search(placeholder_pattern, url)
		if match:
			url = url[:match.start()]
		
		# Clean up trailing slashes and multiple slashes
		url = re.sub(r'/+$', '', url)  # Remove trailing slashes
		url = re.sub(r'/+', '/', url)  # Clean up multiple slashes
		
		# Fix missing slash after http: (common issue)
		url = re.sub(r'^http:/', 'http://', url)
		
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



