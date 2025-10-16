import os
import pytest
import requests
from tests.config import BASE_URL as BASE, ACCEPT_INSECURE_CERTS


@pytest.mark.ui
def test_home_and_login_pages_reachable():
    # Allow self-signed
    kwargs = dict(timeout=5,
                  allow_redirects=True,
                  verify=not ACCEPT_INSECURE_CERTS)
    r = requests.get(BASE + '/', **kwargs)
    assert r.status_code in (200, 301, 302, 401)
    # Login page should exist
    r2 = requests.get(BASE + '/login', **kwargs)
    assert r2.status_code in (200, 401)
