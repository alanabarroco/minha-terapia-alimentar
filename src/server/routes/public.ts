import { h } from '../html';
import { Ctx, route, htmlRes, redirect, respond, simplePage, page, csrfField, fv, cookieStr, homeFor, notFound } from '../web';
import { login, destroySession, SESSION_COOKIE, acceptInvite, peekToken, resetPassword, createToken, linkFor, deliverLink,
  changeOwnPassword, throttled, noteFailure } from '../auth';
import { asService, asUser, J1 } from '../db';
import { config } from '../config';

const safeNext = (n: string) => (n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '');

function loginPage(c: Ctx, error?: string, email = '') {
  const motivo = c.url.searchParams.get('motivo');
  const notice = error ? h`<div class="flash err" role="alert">${error}</div>`
    : motivo === 'expirada' ? h`<div class="flash warn" role="status">Sua sessão expirou. Entre novamente para continuar.</div>`
    : motivo === 'desativada' ? h`<div class="flash err" role="alert">Este acesso foi desativado. Fale com a coordenação.</div>`
    : motivo === 'login' ? h`<div class="flash warn" role="status">Entre para acessar esta página.</div>`
    : motivo === 'saiu' ? h`<div class="flash ok" role="status">Você saiu com segurança.</div>` : '';
  const next = safeNext(c.url.searchParams.get('next') ?? '');
  return htmlRes(c, h`<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · Minha Terapia Alimentar</title><link rel="stylesheet" href="/static/style.css"></head>
<body class="plain"><main class="card narrow" id="conteudo">
<p class="brandbig">Minha Terapia Alimentar</p>
<p class="muted">Acesso restrito a profissionais, escolas e famílias convidadas.</p>
${notice}
<form method="post" action="/entrar" class="stack" autocomplete="on">${csrfField(c)}
<input type="hidden" name="next" value="${next}">
<label>E-mail<input type="email" name="email" value="${email}" required autocomplete="username" autofocus></label>
<label>Senha<input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn primary" type="submit">Entrar</button></form>
<p class="small"><a href="/esqueci-senha">Esqueci minha senha</a></p>
<p class="small muted">Primeiro acesso? Use o link do convite que você recebeu. Não há cadastro aberto ao público.</p>
</main></body></html>`, error ? 401 : 200);
}

route('GET', '/', (c) => (c.user ? redirect(c, homeFor(c.user.role)) : loginPage(c)));
route('GET', '/entrar', (c) => (c.user ? redirect(c, homeFor(c.user.role)) : loginPage(c)));
route('POST', '/entrar', async (c) => {
  const email = fv(c, 'email');
  const r = await login(email, String(c.form?.get('password') ?? ''), c.ip);
  if (!r.ok) return loginPage(c, r.error, email);
  c.setCookie.push(cookieStr(SESSION_COOKIE, r.token, { maxAge: r.maxAge }));
  return redirect(c, safeNext(fv(c, 'next')) || homeFor(r.user.role));
});
route('POST', '/sair', async (c) => {
  await destroySession(c.cookies[SESSION_COOKIE]);
  c.setCookie.push(cookieStr(SESSION_COOKIE, '', { maxAge: 0 }));
  return redirect(c, '/entrar?motivo=saiu');
});

// ---------- recuperação de senha ----------
route('GET', '/esqueci-senha', (c) => htmlRes(c, simplePage(c, 'Recuperar senha', h`
<p>Informe o e-mail da sua conta. Se ele estiver cadastrado, você receberá um link para criar uma nova senha.</p>
<form method="post" action="/esqueci-senha" class="stack">${csrfField(c)}
<label>E-mail<input type="email" name="email" required autocomplete="username"></label>
<button class="btn primary">Enviar link</button></form><p class="small"><a href="/entrar">Voltar ao login</a></p>`)));
route('POST', '/esqueci-senha', async (c) => {
  const email = fv(c, 'email').toLowerCase();
  if (email && !throttled(`rec|${c.ip}`)) {
    noteFailure(`rec|${c.ip}`);
    await asService(async (tx) => {
      const u = await J1<any>(tx, `select u.id from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = $1 and p.active`, [email]);
      if (!u) return; // resposta idêntica para e-mail inexistente
      const t = await createToken(tx, 'recuperacao', email, null, 2);
      await deliverLink(tx, { kind: 'recuperacao', email, tokenId: t.id, link: linkFor('recuperacao', t.token),
        subject: 'Minha Terapia Alimentar — redefinir senha', text: 'Use o link abaixo (válido por 2 horas) para criar uma nova senha.' });
    });
  }
  return htmlRes(c, simplePage(c, 'Verifique seu e-mail', h`<p>Se o e-mail informado estiver cadastrado, enviamos as instruções para redefinir a senha. Se não chegar em alguns minutos, fale com a coordenação.</p><p><a class="btn" href="/entrar">Voltar ao login</a></p>`));
});
function resetForm(c: Ctx, token: string, error?: string) {
  return htmlRes(c, simplePage(c, 'Criar nova senha', h`${error ? h`<div class="flash err" role="alert">${error}</div>` : ''}
<form method="post" action="/redefinir/${token}" class="stack">${csrfField(c)}
<label>Nova senha<input type="password" name="password" required minlength="10" autocomplete="new-password"><span class="hint">Mínimo de 10 caracteres, com letras e números.</span></label>
<label>Repita a nova senha<input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
<button class="btn primary">Salvar nova senha</button></form>`), error ? 400 : 200);
}
route('GET', '/redefinir/:token', async (c) => {
  if (!(await peekToken('recuperacao', c.params.token)))
    return htmlRes(c, simplePage(c, 'Link inválido', h`<p>Este link expirou ou já foi usado. <a href="/esqueci-senha">Solicite um novo</a>.</p>`), 410);
  return resetForm(c, c.params.token);
});
route('POST', '/redefinir/:token', async (c) => {
  const pw = String(c.form?.get('password') ?? '');
  if (pw !== String(c.form?.get('password2') ?? '')) return resetForm(c, c.params.token, 'As senhas não coincidem.');
  const r = await resetPassword(c.params.token, pw);
  if (!r.ok) return resetForm(c, c.params.token, r.error);
  return redirect(c, '/entrar', { ok: 'Senha alterada. Entre com a nova senha.' });
});

// ---------- primeiro acesso por convite ----------
async function inviteForm(c: Ctx, token: string, error?: string) {
  const t = await peekToken('convite', token);
  if (!t) return htmlRes(c, simplePage(c, 'Convite indisponível', h`<p>Este convite expirou, já foi usado ou foi cancelado. Peça um novo convite à coordenação.</p>`), 410);
  const inv = await asService((tx) => J1<any>(tx, `select full_name, role from public.invitations where lower(email) = $1 and status = 'pendente'`, [t.email]));
  return htmlRes(c, simplePage(c, 'Primeiro acesso', h`<p>Convite para <strong>${t.email}</strong>. Crie sua senha para entrar.</p>
${error ? h`<div class="flash err" role="alert">${error}</div>` : ''}
<form method="post" action="/convite/${token}" class="stack">${csrfField(c)}
<label>Seu nome<input name="full_name" value="${inv?.full_name ?? ''}" required maxlength="120" autocomplete="name"></label>
<label>Crie uma senha<input type="password" name="password" required minlength="10" autocomplete="new-password"><span class="hint">Mínimo de 10 caracteres, com letras e números.</span></label>
<label>Repita a senha<input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
<button class="btn primary">Ativar meu acesso</button></form>`), error ? 400 : 200);
}
route('GET', '/convite/:token', (c) => inviteForm(c, c.params.token));
route('POST', '/convite/:token', async (c) => {
  const pw = String(c.form?.get('password') ?? '');
  if (pw !== String(c.form?.get('password2') ?? '')) return inviteForm(c, c.params.token, 'As senhas não coincidem.');
  const r = await acceptInvite(c.params.token, fv(c, 'full_name'), pw);
  if (!r.ok) return inviteForm(c, c.params.token, r.error);
  return redirect(c, '/entrar', { ok: 'Acesso ativado! Entre com seu e-mail e a senha que você criou.' });
});

// ---------- minha conta ----------
route('GET', '/conta', (c) => {
  const u = c.user!;
  const prof = u.role === 'master_alana' || u.role === 'master_cores' || u.role === 'supervisionado';
  return htmlRes(c, page(c, { title: 'Minha conta', body: h`<h1>Minha conta</h1>
<section class="card"><h2>Dados do perfil</h2><p class="muted">E-mail: ${u.email}</p>
<form method="post" action="/conta" class="stack">${csrfField(c)}
<label>Nome<input name="full_name" value="${u.full_name}" required maxlength="120"></label>
${prof ? h`<label>Registro profissional (CRN ou equivalente)<input name="crn" value="${u.crn ?? ''}" maxlength="60" placeholder="Preencha apenas se desejar que apareça nos relatórios"></label>
<label>Título/cargo<input name="professional_title" value="${u.professional_title ?? ''}" maxlength="120" placeholder="Ex.: Nutricionista"></label>` : ''}
<button class="btn primary">Salvar</button></form></section>
<section class="card"><h2>Alterar senha</h2>
<form method="post" action="/conta/senha" class="stack">${csrfField(c)}
<label>Senha atual<input type="password" name="current" required autocomplete="current-password"></label>
<label>Nova senha<input type="password" name="next" required minlength="10" autocomplete="new-password"></label>
<button class="btn">Alterar senha</button></form></section>` }));
}, ['master_alana', 'master_cores', 'supervisionado', 'escola', 'familia']);
route('POST', '/conta', async (c) => {
  const u = c.user!;
  const prof = u.role === 'master_alana' || u.role === 'master_cores' || u.role === 'supervisionado';
  await asUser(u.id, async (tx) => {
    if (prof) await tx`update public.profiles set full_name = ${fv(c, 'full_name')}, crn = ${fv(c, 'crn') || null},
      professional_title = ${fv(c, 'professional_title') || null} where id = ${u.id}`;
    else await tx`update public.profiles set full_name = ${fv(c, 'full_name')} where id = ${u.id}`;
  });
  return redirect(c, '/conta', { ok: 'Dados salvos.' });
}, ['master_alana', 'master_cores', 'supervisionado', 'escola', 'familia']);
route('POST', '/conta/senha', async (c) => {
  const r = await changeOwnPassword(c.user!.id, c.user!.email, String(c.form?.get('current') ?? ''), String(c.form?.get('next') ?? ''));
  return redirect(c, '/conta', r.ok ? { ok: 'Senha alterada.' } : { err: r.error });
}, ['master_alana', 'master_cores', 'supervisionado', 'escola', 'familia']);
