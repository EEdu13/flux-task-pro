/*
 * Presença nas reuniões (pedido do usuário, 10/10/2026): "emitir relatório de
 * presenças de quem participou da reunião... fica salvo pra quem criou a
 * reunião sempre".
 *
 * As salas são permanentes (gestor.salas); o que faltava era a REUNIÃO — cada
 * vez que alguém abre uma sala e outros entram — e quem esteve nela, de que
 * hora a que hora. Nada disso era guardado.
 *
 *   reunioes            uma sessão de uma sala: quem abriu, quando começou e o
 *                       último sinal de vida (o fim, quando ninguém mais manda)
 *   reuniao_presencas   cada trecho em que uma pessoa (ou convidado por link)
 *                       ficou na reunião; sair e voltar abre um trecho novo
 *
 * Só ACRESCENTA tabelas; não toca em nada que já existe.
 */

CREATE TABLE gestor.reunioes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_reunioes_id DEFAULT (newsequentialid()),
  sala NVARCHAR(80) NOT NULL,
  titulo_da_sala NVARCHAR(120) NULL,
  criada_por INT NOT NULL,
  inicio DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_reunioes_inicio DEFAULT (sysdatetimeoffset()),
  ultimo_sinal DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_reunioes_sinal DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_reunioes PRIMARY KEY CLUSTERED (id)
);
CREATE INDEX IX_reunioes_sala_sinal ON gestor.reunioes (sala, ultimo_sinal DESC);
CREATE INDEX IX_reunioes_criador ON gestor.reunioes (criada_por, inicio DESC);

CREATE TABLE gestor.reuniao_presencas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_reuniao_presencas_id DEFAULT (newsequentialid()),
  reuniao_id UNIQUEIDENTIFIER NOT NULL,
  identidade NVARCHAR(120) NOT NULL,
  pessoa_id INT NULL,
  nome NVARCHAR(160) NOT NULL,
  convidado BIT NOT NULL CONSTRAINT DF_reuniao_presencas_conv DEFAULT ((0)),
  entrou_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_reuniao_presencas_entrou DEFAULT (sysdatetimeoffset()),
  ultimo_sinal DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_reuniao_presencas_sinal DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_reuniao_presencas PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_reuniao_presencas_reuniao FOREIGN KEY (reuniao_id) REFERENCES gestor.reunioes(id) ON DELETE CASCADE
);
CREATE INDEX IX_reuniao_presencas_reuniao ON gestor.reuniao_presencas (reuniao_id, identidade, ultimo_sinal DESC);
