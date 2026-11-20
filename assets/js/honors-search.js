(() => {
  const selector = '#honors-search-input';
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

  function filter(input) {
    const page = input.closest('.honors-page');
    const query = normalize(input.value);
    const words = query.split(' ').filter(Boolean);
    let total = 0;
    for (const section of page.querySelectorAll('.honors-section')) {
      const title = section.querySelector('h2').textContent;
      let matches = 0;
      for (const record of section.querySelectorAll('[data-honors-record]')) {
        const text = normalize(title + ' ' + record.textContent);
        const visible = words.every(word => text.includes(word));
        record.hidden = !visible;
        if (visible) matches++;
      }
      section.hidden = !!query && matches === 0;
      const count = section.querySelector('.honors-count');
      if (count) count.textContent = matches + ' 项';
      total += matches;
    }
    const status = page.querySelector('#honors-search-status');
    status.hidden = !query;
    status.textContent = query ? '共找到 ' + total + ' 项相关记录' : '';
    page.querySelector('[data-honors-clear]').hidden = !input.value;
    page.querySelector('.honors-no-results').hidden = !query || total > 0;
    page.querySelector('#honors-records').hidden = !!query && total === 0;
  }

  function sortTable(button) {
    const table = button.closest('table');
    const heading = button.closest('th');
    const ascending = heading.getAttribute('aria-sort') !== 'ascending';
    const direction = ascending ? 1 : -1;
    const rows = [...table.tBodies[0].querySelectorAll('[data-honors-record]')];
    rows.sort((a, b) => direction * a.dataset.honorsDate.localeCompare(b.dataset.honorsDate));
    table.tBodies[0].append(...rows);
    heading.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    const next = ascending ? '按时间倒序排列（最新在前）' : '按时间正序排列（最早在前）';
    const sectionTitle = table.closest('.honors-section').querySelector('h2').textContent.trim();
    button.title = next;
    button.setAttribute('aria-label', sectionTitle + '：' + next);
    button.querySelector('i').className = ascending ? 'fas fa-arrow-up-wide-short' : 'fas fa-arrow-down-wide-short';
    const order = ascending ? '从旧到新' : '从新到旧';
    table.caption.textContent = sectionTitle + '，按时间' + order + '排列';
    const status = document.getElementById('panel-status');
    if (status) status.textContent = sectionTitle + '已按时间' + order + '排列';
  }

  function clear(input) {
    input.value = '';
    filter(input);
    input.focus({ preventScroll: true });
  }

  function handleInput(event) {
    if (event.target.matches(selector) && !event.isComposing) filter(event.target);
  }

  document.addEventListener('input', handleInput);
  document.addEventListener('compositionend', handleInput);
  document.addEventListener('click', event => {
    const sortButton = event.target.closest('[data-honors-sort]');
    if (sortButton) sortTable(sortButton);
    const button = event.target.closest('[data-honors-clear]');
    if (button) clear(button.closest('.honors-page').querySelector(selector));
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches(selector) && event.key === 'Escape' && event.target.value) {
      event.preventDefault();
      event.stopPropagation();
      clear(event.target);
    }
  });
  const initialize = () => {
    const input = document.querySelector(selector);
    if (input) filter(input);
  };
  document.addEventListener('site:content-loaded', initialize);
  initialize();
})();
