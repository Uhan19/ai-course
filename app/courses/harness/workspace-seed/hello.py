import platform
import sys

print("Hello from inside the sandbox!")
print("Python", sys.version.split()[0], "on", platform.system(), platform.machine())
