// JavaScript mínimo e opcional (a aplicação funciona sem ele).
document.querySelectorAll('[data-confirm]').forEach((el) => {
  el.addEventListener('click', (e) => { if (!confirm(el.getAttribute('data-confirm'))) e.preventDefault(); });
});
document.querySelectorAll('[data-add-row]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tpl = document.getElementById(btn.getAttribute('data-add-row'));
    if (!tpl) return;
    const n = document.querySelectorAll('[data-row-of="' + tpl.id + '"]').length;
    const div = document.createElement('div');
    div.setAttribute('data-row-of', tpl.id);
    div.innerHTML = tpl.innerHTML.replaceAll('__N__', String(n));
    tpl.parentNode.insertBefore(div, tpl);
  });
});
// Máscara DD/MM/AAAA enquanto digita
document.querySelectorAll('input[data-mask="date"]').forEach((el) => {
  el.addEventListener('input', () => {
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    el.value = d.length > 4 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4) : d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
});
document.querySelectorAll('input[readonly]').forEach((el) => el.addEventListener('focus', () => el.select()));
