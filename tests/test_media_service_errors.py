from unittest.mock import patch, MagicMock
from services.media import MediaService


class _TP:

    def add(self, fn, args):
        fn(args)

    def stop(self):
        pass


class _SQL:

    def __init__(self):
        self.ready_ids = []

    def file_ready(self, args):
        self.ready_ids.append(args[0])

    def file_update_metadata(self, args):
        pass

    def file_update_real_name(self, args):
        pass

    def order_by_id(self, args):

        class _O:
            attachments = []
            id = 1

        return _O()

    def order_edit_attachments(self, args):
        pass


def _svc(sql):
    return MediaService(_TP(), "/tmp", sql, None)


def test_convert_async_marks_ready_on_ffmpeg_error():
    sql = _SQL()
    ms = _svc(sql)
    with patch("services.media.path.exists", return_value=True), \
     patch("services.media.os.path.splitext", return_value=("/tmp/a",".mp4")), \
     patch("services.media.Popen") as mp:
        proc = MagicMock()
        proc.communicate.return_value = ("", "err")
        proc.returncode = 1
        mp.return_value = proc
        ms._convert(("/tmp/a.webm", "/tmp/a.mp4", ('file', 3)))
    assert 3 in sql.ready_ids


def test_convert_async_timeout_marks_ready():
    sql = _SQL()
    ms = _svc(sql)
    with patch("services.media.path.exists", return_value=True), \
     patch("services.media.os.path.splitext", return_value=("/tmp/a",".mp4")), \
     patch("services.media.Popen") as mp:
        proc = MagicMock()

        def _raise(*a, **k):
            raise Exception("timeout")

        proc.communicate.side_effect = _raise
        mp.return_value = proc
        ms._convert(("/tmp/a.webm", "/tmp/a.mp4", ('file', 5)))
    assert 5 in sql.ready_ids

