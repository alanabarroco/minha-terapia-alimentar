"""Verificação visual em navegador real (Chromium): celular (390px) e computador (1280px).
Confere ausência de rolagem horizontal, login/logout/recarregar e salva capturas em /tmp/mta-shots."""
import os, re, sys, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:3100')
creds = dict(l.split() for l in open(os.environ.get('CREDS', 'data/demo-credentials.txt')) if l.strip())
os.makedirs('/tmp/mta-shots', exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append((ok, name, detail)); print(('PASSOU' if ok else 'FALHOU'), name, detail)

def login(page, email):
    page.goto(BASE + '/entrar'); page.fill('input[name=email]', email); page.fill('input[name=password]', creds[email]); page.click('button[type=submit]')
    page.wait_for_load_state()

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, vp in [('celular', {'width': 390, 'height': 800}), ('computador', {'width': 1280, 'height': 900})]:
        ctx = b.new_context(viewport=vp, device_scale_factor=1, locale='pt-BR', timezone_id='America/Sao_Paulo'); page = ctx.new_page()
        page.goto(BASE + '/'); page.screenshot(path=f'/tmp/mta-shots/{label}-login.png')
        sw = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check(f'16 {label}: login sem rolagem horizontal', sw <= 1, f'excesso={sw}px')
        # credenciais inválidas
        page.fill('input[name=email]', 'x@demo.invalid'); page.fill('input[name=password]', 'errada12345'); page.click('button[type=submit]')
        check(f'15 {label}: credenciais inválidas mostram mensagem', 'E-mail ou senha incorretos' in page.content())
        login(page, 'master.alana@demo.invalid')
        check(f'15 {label}: login do master abre PAINEL MASTER', 'PAINEL MASTER' in page.content() and page.url.endswith('/app'))
        pid = re.search(r'/app/pacientes/([0-9a-f-]{36})', (lambda: (page.goto(BASE + '/app/pacientes'), page.content())[1])()).group(1)
        pages = {'visao': '/app', 'pacientes': '/app/pacientes', 'resumo': f'/app/pacientes/{pid}', 'diario-form': f'/app/pacientes/{pid}/diario/novo',
                 'questionario': f'/app/pacientes/{pid}/questionarios/novo?faixa=2_5', 'crescimento': f'/app/pacientes/{pid}/crescimento', 'mapa': f'/app/pacientes/{pid}/mapa',
                 'sessao': f'/app/pacientes/{pid}/sessoes/novo', 'documentos': f'/app/pacientes/{pid}/documentos', 'usuarios': '/app/usuarios', 'relatorios': '/app/relatorios', 'configuracoes': '/app/configuracoes'}
        for k, u in pages.items():
            page.goto(BASE + u); page.screenshot(path=f'/tmp/mta-shots/{label}-master-{k}.png', full_page=True)
            sw = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(f'16 {label}: master/{k} sem rolagem horizontal', sw <= 1, f'excesso={sw}px')
        # recarregar mantém dados / sessão
        page.goto(BASE + '/app/pacientes'); page.reload(); check(f'14 {label}: após recarregar a lista continua', 'Lucas Demo' in page.content())
        page.click('text=Sair'); check(f'15 {label}: sair encerra a sessão', '/entrar' in page.url and 'saiu com segurança' in page.content())
        page.goto(BASE + '/app'); check(f'15 {label}: após sair, rota protegida volta ao login', '/entrar' in page.url)
        for who, start in [('familia.a@demo.invalid', '/familia'), ('escola.a@demo.invalid', '/escola'), ('supervisionada@demo.invalid', '/app/pacientes')]:
            login(page, who); page.goto(BASE + start); page.screenshot(path=f'/tmp/mta-shots/{label}-{who.split("@")[0]}.png', full_page=True)
            sw = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(f'16 {label}: {who.split("@")[0]} sem rolagem horizontal', sw <= 1, f'excesso={sw}px')
            if who.startswith('familia'):
                page.goto(BASE + '/familia'); page.click('a.stat >> nth=0'); page.screenshot(path=f'/tmp/mta-shots/{label}-familia-crianca.png', full_page=True)
                sw = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'); check(f'16 {label}: família/criança sem rolagem horizontal', sw <= 1, f'excesso={sw}px')
            page.click('text=Sair')
        ctx.close()
    b.close()
bad = [r for r in results if not r[0]]
print(f'\nTotal: {len(results)} | Falhas: {len(bad)}'); sys.exit(1 if bad else 0)
