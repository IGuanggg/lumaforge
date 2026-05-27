# PyInstaller runtime hook: configure SSL certificates before any other code runs.
# This hook executes before the entry script's module-level code, ensuring
# SSL_CERT_FILE is set before the ssl module loads default paths.

import os
import sys
import pathlib

for _env in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
    if os.getenv(_env) and os.path.isfile(os.getenv(_env)):
        break

    _exe = pathlib.Path(sys.executable).resolve().parent
    _meipass = pathlib.Path(getattr(sys, "_MEIPASS", str(_exe)))
    _candidates = [
        _meipass / "certifi" / "cacert.pem",
        _exe / "_internal" / "certifi" / "cacert.pem",
        _exe / "certifi" / "cacert.pem",
    ]
    try:
        import certifi as _certifi
        _candidates.append(pathlib.Path(_certifi.where()))
    except Exception:
        pass

    for _p in _candidates:
        if _p.is_file():
            os.environ["SSL_CERT_FILE"] = str(_p)
            os.environ["REQUESTS_CA_BUNDLE"] = str(_p)
            break
