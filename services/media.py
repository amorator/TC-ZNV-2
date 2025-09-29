from os import path, remove, rename
from subprocess import Popen
from typing import Tuple

from modules.threadpool import ThreadPool


class MediaService:
	def __init__(self, thread_pool: ThreadPool, files_root: str, sql_utils):
		self.thread_pool = thread_pool
		self.files_root = files_root
		self._sql = sql_utils

	def convert_async(self, src_path: str, dst_path: str, entity: Tuple[str, int]) -> None:
		self.thread_pool.add(self._convert, (src_path, dst_path, entity))

	def _convert(self, args):
		old, new, entity = args
		etype, entity_id = entity
		if old == new:
			rename(old, old + '.mp4')
			old += '.mp4'
		process = Popen(["ffmpeg", "-i", old, "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-b:v", "250k", "-vf", "scale=800:600", new], universal_newlines=True)
		process.wait()
		if etype == 'file':
			self._sql.file_ready([entity_id])
		elif etype == 'order':
			ord = self._sql.order_by_id([entity_id])
			ord.attachments.remove(path.basename(old))
			ord.attachments.append(path.basename(new))
			self._sql.order_edit_attachments(['|'.join(ord.attachments), entity_id])
		remove(old)


