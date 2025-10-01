from threading import Thread, Lock
from subprocess import Popen
from time import sleep

class ThreadPool():
    def __init__(self, max=4):
        self.max = max
        self.procs = []
        self._lock = Lock()

    def add(self, target, *args):
        Thread(target=self._add, args=(target, *args)).start()

    def _add(self, target, *args):
        while True:
            with self._lock:
                over = len(self.procs) >= self.max
            if not over:
                break
            sleep(1)
            self.refresh()
        with self._lock:
            self.procs.append(Thread(target=target, args=args))
            self.procs[-1].start()

    def refresh(self):
        with self._lock:
            for proc in list(self.procs):
                if not proc.is_alive():
                    proc.join()
                    self.procs.remove(proc)

    def stop(self):
        """Stop thread pool gracefully.
        
        Waits for all running threads to complete.
        """
        print('Ожидание завершения активных задач...')
        while True:
            with self._lock:
                if not self.procs:
                    break
                # Wait for all threads to complete
                for proc in list(self.procs):
                    if proc.is_alive():
                        proc.join(timeout=1.0)
                    else:
                        self.procs.remove(proc)
            sleep(0.1)
        print('Все задачи завершены.')