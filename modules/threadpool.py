"""Simple thread pool for background tasks with a concurrency cap."""

import logging
import redis
from threading import Thread, Lock
from queue import Queue, Empty
from time import sleep


class ThreadPool:
	"""Cap concurrent tasks and wait for graceful completion on stop."""

	def __init__(self, max: int = 4) -> None:
		self.max = max
		self._lock = Lock()
		self._queue: Queue = Queue()
		self._workers: list[Thread] = []
		self._stopping = False
		self._log = logging.getLogger(__name__)
		# Start worker threads
		for _ in range(self.max):
			t = Thread(target=self._worker, daemon=True)
			self._workers.append(t)
			t.start()

	def add(self, target, *args) -> None:
		"""Queue a new task to run when capacity allows."""
		if self._stopping:
			self._log.warning('ThreadPool is stopping; rejecting new task %s', getattr(target, '__name__', target))
			return
		# Preserve legacy calling where target expects a single tuple arg
		job_args = args if args else tuple()
		self._queue.put((target, job_args))

	def _worker(self) -> None:
		while True:
			try:
				job = self._queue.get(timeout=0.5)
			except Empty:
				if self._stopping:
					break
				continue
			if job is None:
				break
			target, args = job
			try:
				# Legacy behavior: pass args tuple as single positional if provided
				if len(args) == 1 and not isinstance(args[0], (list, tuple)):
					target(args[0])
				elif len(args) == 1:
					target(args[0])
				else:
					target(*args)
			except Exception as e:
				self._log.exception('Error in ThreadPool task: %s', e)
			finally:
				self._queue.task_done()

	def _create_redis_client_for_logging(self):
		"""Create a temporary Redis client for logging synchronization using config settings."""
		try:
			# Import here to avoid circular imports
			from modules.core import Config
			temp_config = Config()
			redis_config = {}
			
			# Try dict-style access first
			try:
				redis_config = temp_config.config['redis']
			except Exception:
				# Fallback to ConfigParser-style access
				try:
					redis_config = {
						'server': temp_config.config.get('redis', 'server', fallback=None),
						'port': temp_config.config.get('redis', 'port', fallback=6379),
						'password': temp_config.config.get('redis', 'password', fallback=None),
						'socket': temp_config.config.get('redis', 'socket', fallback=None),
						'db': temp_config.config.get('redis', 'db', fallback=0)
					}
					# Convert port to int
					try:
						redis_config['port'] = int(redis_config['port'])
					except (ValueError, TypeError):
						redis_config['port'] = 6379
				except Exception:
					redis_config = {}
			
			# Create Redis client using the same logic as RedisClient
			if redis_config.get('socket'):
				if redis_config.get('password'):
					url = f"unix://:{redis_config['password']}@{redis_config['socket']}?db={redis_config.get('db', 0)}"
				else:
					url = f"unix://{redis_config['socket']}?db={redis_config.get('db', 0)}"
			else:
				host = redis_config.get('server', 'localhost')
				port = redis_config.get('port', 6379)
				password = redis_config.get('password')
				db = redis_config.get('db', 0)
				
				if password:
					url = f"redis://:{password}@{host}:{port}/{db}"
				else:
					url = f"redis://{host}:{port}/{db}"
			
			return redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=5)
		except Exception:
			return None

	def stop(self) -> None:
		"""Wait for all running tasks to complete and exit."""
		# Only log thread pool waiting once across all workers using Redis
		redis_client = self._create_redis_client_for_logging()
		if redis_client and redis_client.set('thread_pool_waiting_logged', '1', nx=True, ex=20):
			self._log.info('Ожидание завершения активных задач...')
		self._stopping = True
		# Drain and signal workers to exit
		for _ in self._workers:
			self._queue.put(None)
		for t in self._workers:
			try:
				t.join(timeout=2.0)
			except Exception:
				pass
		self._workers.clear()
		# Only log thread pool completion once across all workers using Redis
		if redis_client and redis_client.set('thread_pool_completed_logged', '1', nx=True, ex=20):
			self._log.info('Все задачи завершены.')