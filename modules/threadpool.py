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
