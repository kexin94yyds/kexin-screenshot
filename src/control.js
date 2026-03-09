const startButton = document.getElementById('startButton');
const settingsButton = document.getElementById('settingsButton');
const permissionNode = document.getElementById('permission');
const shortcutNode = document.getElementById('shortcut');

function formatShortcut(shortcut) {
  const isMac = navigator.platform.toLowerCase().includes('mac');

  if (!isMac) {
    return shortcut.replace('CommandOrControl', 'Ctrl');
  }

  return shortcut
    .replace('CommandOrControl', 'Command')
    .replace(/\+/g, ' + ');
}

function renderStatus(status) {
  shortcutNode.textContent = formatShortcut(status.shortcut);

  permissionNode.className = 'status-pill';

  if (status.captureInProgress) {
    permissionNode.textContent = '截图进行中';
    permissionNode.classList.add('warn');
    startButton.disabled = true;
    return;
  }

  startButton.disabled = false;

  switch (status.screenPermission) {
    case 'granted':
      permissionNode.textContent = status.shortcutRegistered
        ? '权限已就绪'
        : '权限已就绪，快捷键被占用';
      permissionNode.classList.add(status.shortcutRegistered ? 'ok' : 'warn');
      break;
    case 'not-determined':
      permissionNode.textContent = '首次截图时系统可能弹出权限提示';
      permissionNode.classList.add('warn');
      break;
    case 'denied':
    case 'restricted':
      permissionNode.textContent = '缺少屏幕录制权限';
      permissionNode.classList.add('bad');
      break;
    default:
      permissionNode.textContent = '权限状态暂时未知';
      permissionNode.classList.add('warn');
      break;
  }
}

async function refreshStatus() {
  const status = await window.qqShot.getStatus();
  renderStatus(status);
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  try {
    await window.qqShot.startCapture();
  } finally {
    await refreshStatus();
  }
});

settingsButton.addEventListener('click', async () => {
  await window.qqShot.openScreenSettings();
});

window.qqShot.onStatusChanged(renderStatus);
window.addEventListener('focus', refreshStatus);

refreshStatus();
