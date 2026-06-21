# TODO - LiteMe UI no SVoltix

- [ ] Implementar layout estilo LiteMe no `public/dashboard.html` (header + menu lateral).
- [ ] Menu lateral funcional: mostrar “Dashboard” e “Histórico” (com base nas rotas API já existentes), além de manter “Configurações” como placeholder.
- [ ] Integrar a troca de seções via JavaScript (sem framework Angular).
- [ ] Garantir que funcionalidades existentes continuem:
  - [ ] `/api/dashboard` carrega equipamentos
  - [ ] `/grupos` permite renomear grupo
  - [ ] botão Sair limpa localStorage e volta para `index.html`
- [ ] Testar fluxo completo: login → menu → visualização → sair.
