import logging
from modules.logging import init_logging, get_logger


def test_logging_init_creates_loggers(tmp_path, monkeypatch):
    # Point config path to a minimal config
    cfg = tmp_path / "config.ini"
    cfg.write_text("""
[logging]
service_name = znf.service
file_level = INFO
console_level = WARNING
actions_level = INFO
access_level = INFO
""",
                   encoding="utf-8")

    log_cfg = init_logging(str(cfg))
    assert isinstance(log_cfg, object)

    # Root logger should have handlers
    root = logging.getLogger()
    assert root.handlers

    # Access and actions loggers configured
    access = logging.getLogger('access')
    actions = logging.getLogger('actions')
    assert access.handlers
    assert actions.handlers

    # get_logger returns named logger
    logger = get_logger(__name__)
    assert isinstance(logger, logging.Logger)

