"""Simple thread pool for background tasks with a concurrency cap."""

import logging
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

    def stop(self) -> None:
        """Wait for all running tasks to complete and exit."""
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
        self._log.info('Все задачи завершены.')