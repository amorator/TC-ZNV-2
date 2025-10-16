import types
from unittest.mock import patch, MagicMock

from services.media import MediaService


class _DummyTP:

    def stop(self):
        pass


class _DummySQL:

    def file_ready(self, args):
        pass

    def file_update_metadata(self, args):
        pass

    def file_update_real_name(self, args):
        pass


def _make_media_service():
    return MediaService(_DummyTP(), "/tmp", _DummySQL(), socketio=None)


def test_probe_length_uses_format_duration_first():
    ms = _make_media_service()

    # Mock getsize and Popen for format duration path
    with patch("services.media.os.path.getsize", return_value=5 * 1024 * 1024), \
     patch("services.media.Popen") as mock_popen:
        proc = MagicMock()
        proc.communicate.return_value = ("12.34", "")
        proc.returncode = 0
        mock_popen.return_value = proc

        length, size_mb = ms._probe_length_and_size("/tmp/fake.mp4")
        assert length == 12
        assert size_mb == 5.0
        # First call is for format duration
        args, kwargs = mock_popen.call_args
        assert "-show_entries" in args[0] and "format=duration" in args[0]


def test_probe_length_fallbacks_to_stream_then_frames():
    ms = _make_media_service()

    with patch("services.media.os.path.getsize", return_value=0), \
     patch("services.media.Popen") as mock_popen:
        # First ffprobe (format) returns bad output
        proc1 = MagicMock()
        proc1.communicate.return_value = ("", "")
        proc1.returncode = 0
        # Second ffprobe (stream duration) returns bad output
        proc2 = MagicMock()
        proc2.communicate.return_value = ("", "")
        proc2.returncode = 0
        # Third ffprobe (json frames) returns usable data
        proc3 = MagicMock()
        json_out = '{"streams": [{"nb_read_frames": "300", "r_frame_rate": "30/1"}]}'
        proc3.communicate.return_value = (json_out, "")
        proc3.returncode = 0

        mock_popen.side_effect = [proc1, proc2, proc3]

        length, size_mb = ms._probe_length_and_size("/tmp/fake.mp4")
        assert length == 10  # 300 / 30
        assert size_mb == 0.0
