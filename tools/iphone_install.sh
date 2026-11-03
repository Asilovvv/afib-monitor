#!/bin/bash
# AFib Monitor on your iPhone with one command (macOS). iPhone connected by cable, unlocked, "Trust this computer" = yes:
#   curl -fsSL https://raw.githubusercontent.com/Asilovvv/afib-monitor/main/tools/iphone_install.sh | bash
# The first time and then every 7 days: a free Apple ID signs the app for 7 days only (docs/IPHONE_INSTALL.md).
# Installing over the old app keeps its data. Only the app's own folder (~/afib-monitor) is changed:
# 1) gets or updates the app code (only the mobile/ folder of the repository, a few hundred KB);
# 2) installs packages and regenerates the iOS project only when the app's dependencies or settings changed;
# 3) builds the Release version and installs it on the iPhone; prints the date the signature runs out.
set -euo pipefail
REPO=https://github.com/Asilovvv/afib-monitor.git
DIR="${AFIB_APP_DIR:-$HOME/afib-monitor}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Нет программы $1: $2"; exit 1; }; }
need xcodebuild "установите Xcode из App Store, откройте его один раз и согласитесь с лицензией"
need node "установите Node.js LTS с nodejs.org (установщик .pkg)"
need git "выполните: xcode-select --install"
command -v pod >/dev/null 2>&1 || echo "Внимание: нет CocoaPods (pod). Если сборка его попросит: sudo gem install cocoapods"

echo "== Телефоны, которые видит Mac (iPhone должен быть подключён кабелем и разблокирован):"
xcrun devicectl list devices 2>/dev/null || echo "   (список недоступен — продолжаю)"

echo "== Код приложения в $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
elif [ -e "$DIR" ]; then
  echo "Папка $DIR уже есть, но это не копия репозитория. Переименуйте её или задайте другую:"
  echo "  curl -fsSL https://raw.githubusercontent.com/Asilovvv/afib-monitor/main/tools/iphone_install.sh | AFIB_APP_DIR=~/afib-monitor-2 bash"
  exit 1
else
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$DIR"
  git -C "$DIR" sparse-checkout set mobile
fi
cd "$DIR/mobile"

# Packages and the iOS project are rebuilt only when what they depend on changed (saves 10+ minutes and the
# CocoaPods downloads that hung once on this Mac); Personal Team signing set in Xcode is kept by prebuild.
want=$( (cat package-lock.json app.json; cat react-native.config.js 2>/dev/null || true) | shasum | cut -c1-12)
have=$(cat .afib-native-stamp 2>/dev/null || true)
if [ ! -d node_modules ] || [ ! -d ios ] || [ "$want" != "$have" ]; then
  echo "== Пакеты и проект iOS (зависимости изменились или первый раз)"
  npm ci
  npx expo prebuild -p ios
  echo "$want" > .afib-native-stamp
else
  echo "== Зависимости не менялись: только новая версия кода"
fi

echo "== Сборка Release и установка на iPhone (5–15 минут). Если спросят телефон — выберите свой."
if ! npx expo run:ios --device --configuration Release </dev/tty; then
  echo
  echo "Сборка не прошла. Если дело в подписи (signing):"
  echo "  1. open $DIR/mobile/ios/*.xcworkspace"
  echo "  2. слева проект → вкладка Signing & Capabilities → Team = ваш «(Personal Team)»;"
  echo "     если Bundle Identifier занят — поменяйте на свой, например kg.asilov.afibmonitor (и дальше всегда тот же);"
  echo "     если есть строка Push Notifications — удалите её крестиком."
  echo "  3. Запустите эту команду ещё раз."
  exit 1
fi
echo
echo "Готово. Подпись действует до $(date -v+7d '+%d.%m.%Y'): после этого запустите эту же команду ещё раз."
echo "Первый запуск на iPhone: Настройки → Основные → VPN и управление устройством → ваш Apple ID → «Доверять»."
echo "Дальше — подключение датчика: docs/CONNECT.md, шаг 4."
