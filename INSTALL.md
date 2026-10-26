# Install on the Signal K test Pi

Assumptions: user `pi`, Signal K config in `/home/pi/.signalk`, OpenPlotter (Signal K runs as a systemd service). Adjust names if yours differ. `<PI>` = `192.168.0.37`.

## 1. Copy the project to the Pi (from the Windows PC)

Only the plugin files are needed (no map file, no tests required).

In **cmd** (Eingabeaufforderung; replace `pi` if your user differs). Re-run the same steps for every update:

```bat
cd /d D:\Claude\Ankeralarm
tar -cf anchor.tar package.json core plugin public
scp anchor.tar pi@192.168.0.37:/home/pi/
del anchor.tar
```

(Later, when the repo is pushed to GitHub, replace this by `git clone https://github.com/SirReal-surreal/anchor_alarm_signalK.git` on the Pi.)

## 2. Install into Signal K (on the Pi, via SSH)

```bash
mkdir -p ~/anchor_alarm_signalK && tar -xf ~/anchor.tar -C ~/anchor_alarm_signalK
cd ~/.signalk
npm install ~/anchor_alarm_signalK
```

The plugin has no dependencies, so this is quick. `npm install <folder>` links the folder, so later updates only need step 1 + the restart below.

Check: `ls ~/.signalk/node_modules | grep anchor` shows `signalk-anchor-alarm`.

## 3. Restart Signal K

```bash
sudo systemctl restart signalk
```

If that service name does not exist: `systemctl list-units | grep -i signalk`.

## 4. Enable and configure

1. Open `http://<PI>:3000/admin`, log in.
2. **Server -> Plugin Config -> Anchor alarm**.
3. Tick **Enabled**. Check the defaults (antenna offset length `9`, width `-0.5`, radius `35`, paths `navigation.position` / `navigation.headingTrue`). Leave the `$source` fields empty for now. **Submit**.
4. The status line of the plugin should say `Anchor raised`.

## 5. Quick check (from the Windows PC, nothing is dropped yet)

```bash
curl -H "Authorization: Bearer $SK_TOKEN" http://<PI>:3000/signalk/v1/api/vessels/self/navigation/anchor
curl -H "Authorization: Bearer $SK_TOKEN" http://<PI>:3000/plugins/signalk-anchor-alarm/status
```

Expected: `drop` = `false`, `maxRadius` = 35, `heartbeat` changing every 5 s; the status call returns JSON with `"armed":false`. Notification path `notifications/navigation/anchor` shows `"Anchor is raised"`.

Also in the Admin UI, **Data Browser** (filter `anchor`) shows the same values live.

## 6. Tell me, then I run the simulator

With fake GPS/heading running, I will test drop / refuse / alarm / clear / position-lost / restart (`sudo systemctl restart signalk` while dropped must come back armed). Send me:
- the plugin status line and any error in the Signal K log: `journalctl -u signalk -n 100 --no-pager`
- whether step 5 shows the expected values.

## Troubleshooting
- **Plugin not listed in Plugin Config:** step 2 did not link it, or Signal K was not restarted. Check `~/.signalk/package.json` contains `signalk-anchor-alarm`.
- **Plugin listed but errors on enable:** copy the error from `journalctl -u signalk`.
- **401 on curl:** the token in `.env` is missing/expired - tell me and I request a new one.
