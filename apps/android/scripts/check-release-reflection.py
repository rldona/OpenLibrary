#!/usr/bin/env python3
"""
Checks a minified (R8) APK for classes that are created by reflection but lost the constructor
they need: R8's full mode keeps a class named by a rule without its constructors unless the rule
lists them, and the failure only shows on a device, in release builds (ML Kit's registrars, 2026-11).

Classes checked, all read from the APK's own manifest (with a no-argument constructor unless\nCONSTRUCTOR_FOR_META_DATA says otherwise):
  - application, activities, services, receivers and providers: no-argument constructor;
  - firebase-components registrars (meta-data "com.google.firebase.components:<class>"),
    used by ML Kit: no-argument constructor;
  - androidx.startup initializers (meta-data with value "androidx.startup"): no-argument constructor;
  - other meta-data values that name a class of the APK (CameraX's config provider…): no-argument constructor.

Usage: check-release-reflection.py <app.apk>   (needs aapt2 and dexdump from the Android build-tools)
"""
import os
import re
import subprocess
import sys
import tempfile
import zipfile


# Meta-data whose class is created with a constructor other than the no-argument one.
CONSTRUCTOR_FOR_META_DATA = {
    # Credential Manager: CredentialProviderPlayServicesImpl(Context).
    "androidx.credentials.CREDENTIAL_PROVIDER_KEY": "Landroid/content/Context;",
}


def build_tool(name: str) -> str:
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or os.path.expanduser("~/Android/Sdk")
    root = os.path.join(sdk, "build-tools")
    versions = sorted(os.listdir(root), key=lambda v: [int(x) if x.isdigit() else x for x in re.split(r"[.-]", v)])
    return os.path.join(root, versions[-1], name)


def manifest_classes(apk: str) -> dict[str, tuple[str, str]]:
    """Class name → (why it must be instantiable, constructor parameters it needs)."""
    out = subprocess.run(
        [build_tool("aapt2"), "dump", "xmltree", "--file", "AndroidManifest.xml", apk],
        check=True, capture_output=True, text=True,
    ).stdout
    package = re.search(r'package="([^"]+)"', out).group(1)
    found: dict[str, tuple[str, str]] = {}
    element = None
    attrs: dict[str, str] = {}

    def flush():
        if element is None:
            return
        name, value = attrs.get("name"), attrs.get("value")
        if element in ("application", "activity", "service", "receiver", "provider") and name:
            cls = package + name if name.startswith(".") else name
            found[cls] = (f"<{element}>", "")
        if element == "meta-data" and name:
            if name.startswith("com.google.firebase.components:"):
                found[name.split(":", 1)[1]] = ("firebase-components registrar", "")
            elif value == "androidx.startup":
                found[name] = ("androidx.startup initializer", "")
            elif value and re.fullmatch(r"[a-z][\w]*(\.[\w$]+)+", value) and re.search(r"\.[A-Z][\w$]*$", value):
                found[value] = (f"meta-data {name}", CONSTRUCTOR_FOR_META_DATA.get(name, ""))

    for line in out.splitlines():
        m = re.match(r"\s*E: ([\w-]+)", line)
        if m:
            flush()
            element, attrs = m.group(1), {}
            continue
        m = re.match(r'\s*A: http://schemas.android.com/apk/res/android:(name|value)\([^)]*\)="([^"]*)"', line)
        if m:
            attrs[m.group(1)] = m.group(2)
    flush()
    return found


def constructors(apk: str) -> dict[str, list[str]]:
    """Class name → signatures of its constructors, for every class in the APK's dex files."""
    result: dict[str, list[str]] = {}
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(apk) as z:
        for entry in z.namelist():
            if not re.fullmatch(r"classes\d*\.dex", entry):
                continue
            path = z.extract(entry, tmp)
            dump = subprocess.run([build_tool("dexdump"), path], check=True, capture_output=True, text=True).stdout
            for block in dump.split("Class #")[1:]:
                m = re.search(r"Class descriptor\s*:\s*'L([^;]+);'", block)
                if not m:
                    continue
                direct = block.split("Direct methods")[1].split("Virtual methods")[0] if "Direct methods" in block else ""
                result[m.group(1).replace("/", ".")] = re.findall(
                    r"name\s*:\s*'<init>'\s*\n\s*type\s*:\s*'\(([^)]*)\)V'", direct
                )
    return result


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    apk = sys.argv[1]
    wanted = manifest_classes(apk)
    ctors = constructors(apk)
    problems = []
    for cls, (why, params) in sorted(wanted.items()):
        if cls not in ctors:
            # Framework classes and classes of other apps are not in the APK: nothing to check.
            continue
        if params not in ctors[cls]:
            needed = f"({params})" if params else "no-argument"
            problems.append(f"{cls} ({why}) lost its {needed} constructor; it has: {ctors[cls] or 'none'}")
    checked = sum(1 for c in wanted if c in ctors)
    if problems:
        print("Classes created by reflection lost their constructor in the minified APK:")
        for p in problems:
            print("  - " + p)
        print("Add a keep rule with the constructor in apps/android/app/proguard-rules.pro.")
        return 1
    print(f"OK: {checked} classes created by reflection keep the constructor they need.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
