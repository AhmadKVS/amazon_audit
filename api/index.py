import sys
import os

# Add repo root and backend/ to path so all imports resolve
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, repo_root)
sys.path.insert(0, os.path.join(repo_root, "backend"))

from backend.app.main import app
