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
