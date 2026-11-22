#!/bin/bash
set -e
export PATH=/workspace/toolchain/jdk/bin:$PATH
BT=/workspace/toolchain/bt
AJ=/workspace/toolchain/platform/android-34/android.jar
cd /workspace/motorledger/android
rm -rf classes dex unsigned.apk aligned.apk out.apk
$BT/aapt2 compile --dir res -o res.zip
$BT/aapt2 link -o unsigned.apk -I $AJ res.zip --manifest AndroidManifest.xml --min-sdk-version 21 --target-sdk-version 34 --version-code 5 --version-name 1.4 -A assets
javac -source 1.8 -target 1.8 -classpath $AJ -d classes src/au/com/jmarrone/motorledger/*.java 2>&1 | grep -vi warning || true
mkdir -p dex
$BT/d8 --release --min-api 21 --lib $AJ --output dex $(find classes -name "*.class")
python3 - <<'PY2'
import zipfile
src = zipfile.ZipFile('unsigned.apk')
out = zipfile.ZipFile('out.apk', 'w', zipfile.ZIP_DEFLATED)
for n in src.namelist():
    # resources.arsc must be STORED (uncompressed) and aligned for targetSdk 30+
    if n == 'resources.arsc':
        out.writestr(zipfile.ZipInfo(n), src.read(n))
    else:
        out.writestr(n, src.read(n))
out.write('dex/classes.dex', 'classes.dex')
out.close()
print('packaged')
PY2
$BT/zipalign -f 4 out.apk aligned.apk
if [ ! -f motorledger.keystore ]; then
  keytool -genkeypair -keystore motorledger.keystore -alias motorledger -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass motorledger1 -keypass motorledger1 -dname "CN=MotorLedger, O=JMarrone, L=Hobart, ST=TAS, C=AU"
fi
$BT/apksigner sign --ks motorledger.keystore --ks-pass pass:motorledger1 --out MotorLedger_v1.4.apk aligned.apk
$BT/apksigner verify --print-certs MotorLedger_v1.4.apk
ls -la MotorLedger_v1.4.apk
