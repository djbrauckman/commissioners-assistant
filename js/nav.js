/**
 * nav.js
 * Injects shared navigation into every page.
 * Call initNav() with the current page key to highlight the active tab.
 */

const NAV_LINKS = [
  { key: 'schedule', label: 'Schedule', href: 'index.html' },
  { key: 'stats',    label: 'Stats',    href: 'stats.html' },
  { key: 'dues',     label: 'Dues',     href: 'dues.html' },
  { key: 'history',  label: 'History',  href: 'history.html' },
  { key: 'keepers',  label: 'Keepers',  href: 'keepers.html' },
  { key: 'draft-research', label: 'Draft Research', href: 'draft-research.html' },
];

function initNav(activePage) {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  nav.innerHTML = NAV_LINKS.map(link => {
    const isActive   = link.key === activePage;
    const isDisabled = link.disabled;
    return `
      <a
        href="${isDisabled ? '#' : link.href}"
        class="nav-link ${isActive ? 'nav-link--active' : ''} ${isDisabled ? 'nav-link--disabled' : ''}"
        ${isDisabled ? 'title="Coming soon"' : ''}
      >${link.label}${isDisabled ? ' <span class="nav-soon">soon</span>' : ''}</a>
    `;
  }).join('');
}