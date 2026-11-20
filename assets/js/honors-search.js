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

  const names = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });
  const sortDescription = (key, ascending) => ({
    date: ascending ? '时间正序（最早在前）' : '时间倒序（最新在前）',
    name: ascending ? '名称正序（拼音 A-Z）' : '名称倒序（拼音 Z-A）',
    award: ascending ? '奖项由低到高' : '奖项由高到低',
    organizer: ascending ? '单位由小到大（学院、学校、省级、国际或全国）' : '单位由大到小（国际或全国、省级、学校、学院）'
  })[key];

  function awardOrder(value) {
    if (/特等奖/.test(value)) return 6;
    if (/一等奖|金奖/.test(value)) return 5;
    if (/二等奖|银奖/.test(value)) return 4;
    if (/三等奖|铜奖/.test(value)) return 3;
    if (/优秀|H奖/i.test(value)) return 2;
    return 1;
  }

  function sortTable(button) {
    const table = button.closest('table');
    const heading = button.closest('th');
    const key = button.dataset.honorsSort;
    const previous = heading.getAttribute('aria-sort');
    const ascending = previous ? previous !== 'ascending' : key === 'name';
    const direction = ascending ? 1 : -1;
    const rows = [...table.tBodies[0].querySelectorAll('[data-honors-record]')];
    rows.sort((a, b) => {
      if (key === 'date') return direction * a.dataset.honorsDate.localeCompare(b.dataset.honorsDate);
      if (key === 'name') return direction * names.compare(a.dataset.honorsName, b.dataset.honorsName);
      if (key === 'award') return direction * (awardOrder(a.dataset.honorsAward) - awardOrder(b.dataset.honorsAward));
      return direction * (Number(a.dataset.honorsOrganizerOrder) - Number(b.dataset.honorsOrganizerOrder)) || names.compare(a.dataset.honorsOrganizer, b.dataset.honorsOrganizer);
    });
    table.tBodies[0].append(...rows);
    const sectionTitle = table.closest('.honors-section').querySelector('h2').textContent.trim();
    table.querySelectorAll('th[aria-sort]').forEach(th => th.removeAttribute('aria-sort'));
    for (const control of table.querySelectorAll('[data-honors-sort]')) {
      control.querySelector('i').className = 'fas fa-sort';
      const next = sortDescription(control.dataset.honorsSort, control.dataset.honorsSort === 'name');
      control.title = '按' + next + '排序';
      control.setAttribute('aria-label', sectionTitle + '：' + control.title);
    }
    heading.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    const next = sortDescription(key, !ascending);
    button.title = '按' + next + '排序';
    button.setAttribute('aria-label', sectionTitle + '：' + button.title);
    button.querySelector('i').className = ascending ? 'fas fa-arrow-up-wide-short' : 'fas fa-arrow-down-wide-short';
    const current = sortDescription(key, ascending);
    table.caption.textContent = sectionTitle + '，按' + current + '排序';
    const status = document.getElementById('panel-status');
    if (status) status.textContent = sectionTitle + '已按' + current + '排序';
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
