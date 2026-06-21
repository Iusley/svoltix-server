require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization']
}));

app.use(express.json());
app.use(
    express.static(
        'public'
    )
);

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});


//--------------------------------------------------
// LOGIN
//--------------------------------------------------

app.post('/login', async (req, res) => {

    try {

        const {
            usuario,
            senha
        } = req.body;

        const resultado =
            await pool.query(
                `
                SELECT *
                FROM usuarios
                WHERE usuario = $1
                AND senha = $2
                `,
                [
                    usuario,
                    senha
                ]
            );

        if(resultado.rows.length === 0)
        {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Usuário ou senha inválidos'
            });
        }

        res.json({
            sucesso: true,
            usuario:
                resultado.rows[0].usuario
        });

    }
    catch(error)
    {
        console.error(error);

        res.status(500).json({
            sucesso: false,
            erro: error.message
        });
    }

});

// TESTE
app.get('/', (req, res) => {
    res.sendFile(
        __dirname +
        '/public/index.html'
    );
});

// INSERIR TELEMETRIA
app.post('/telemetria', async (req, res) => {

    try {

        const {
            dispositivo,
            valor
        } = req.body;

        await pool.query(
            `
            INSERT INTO telemetria
            (
                dispositivo,
                valor
            )
            VALUES
            (
                $1,
                $2
            )
            `,
            [
                dispositivo,
                valor
            ]
        );

        res.json({
            sucesso: true
        });

    }
    catch(error)
    {
        console.error(error);

        res.status(500).json({
            sucesso: false,
            erro: error.message
        });
    }

});

//--------------------------------------------------
// RESUMO DASHBOARD
//--------------------------------------------------

app.get('/resumo', async (req, res) => {

    try {

        const ultimo =
            await pool.query(
                `
                SELECT *
                FROM telemetria
                ORDER BY id DESC
                LIMIT 1
                `
            );

        const total =
            await pool.query(
                `
                SELECT COUNT(*)
                FROM telemetria
                `
            );

        res.json({

            ultimo:
                ultimo.rows[0],

            total:
                total.rows[0].count

        });

    }
    catch(error)
    {
        res.status(500).json({
            erro: error.message
        });
    }

});

//--------------------------------------------------
// ULTIMOS REGISTROS
//--------------------------------------------------

app.get('/ultimos', async (req, res) => {

    try {

        const resultado =
            await pool.query(
                `
                SELECT *
                FROM telemetria
                ORDER BY id DESC
                LIMIT 20
                `
            );

        res.json(
            resultado.rows
        );

    }
    catch(error)
    {
        res.status(500).json({
            erro: error.message
        });
    }

});





//--------------------------------------------------
// GRUPOS
//--------------------------------------------------

app.get('/grupos', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT dispositivo, nome_grupo FROM grupos'
        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            erro: 'Erro ao buscar grupos'
        });
    }
});

app.post('/grupos', async (req, res) => {

    const {
        dispositivo,
        nome_grupo
    } = req.body;

    if (!dispositivo || !nome_grupo) {

        return res.status(400).json({
            erro:
            'dispositivo e nome_grupo são obrigatórios'
        });
    }

    try {

        await pool.query(
            `
            INSERT INTO grupos
            (
                dispositivo,
                nome_grupo
            )
            VALUES
            (
                $1,
                $2
            )
            ON CONFLICT
            (
                dispositivo
            )
            DO UPDATE SET

            nome_grupo =
            EXCLUDED.nome_grupo
            `,
            [
                dispositivo,
                nome_grupo
            ]
        );

        res.json({
            sucesso:true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            erro:
            'Erro ao salvar grupo'
        });
    }
});



app.get(
    '/api/dashboard',
    async (req, res) =>
{
    try
    {
        const result =
            await pool.query(`
                SELECT DISTINCT ON (device)
                    device,
                    va,
                    vb,
                    vc,
                    ia,
                    ib,
                    ic,

                    fpa,
                    fpb,
                    fpc,
                    fpt,

                    pa,
                    pb,
                    pc,
                    pt,

                    sa,
                    sb,
                    sc,
                    st,

                    qa,
                    qb,
                    qc,

                    hz,
                    tc,

                    created_at

                FROM telemetria
                ORDER BY device, id DESC
            `);

        res.json(
            result.rows
        );
    }
    catch(err)
    {
        console.log(err);

        res.status(500).json({
            erro: err.message
        });
    }
});

//--------------------------------------------------
// INICIAR SERVIDOR
//--------------------------------------------------

app.listen(
    process.env.PORT,
    () =>
    {
        console.log(
            `Servidor SVoltix rodando na porta ${process.env.PORT}`
        );
    }
);

app.get(
    "/api/ultima-leitura/:device",
    async (req, res) =>
{
    try
    {
        const result =
            await pool.query(
                `
                SELECT *
                FROM telemetria
                WHERE device = $1
                ORDER BY id DESC
                LIMIT 1
                `,
                [req.params.device]
            );

        res.json(
            result.rows[0]
        );
    }
    catch(err)
    {
        res.status(500).json({
            erro: err.message
        });
    }
});


app.get(
    "/api/dispositivos",
    async (req, res) =>
{
    const result =
        await pool.query(
            `
            SELECT DISTINCT device
            FROM telemetria
            ORDER BY device
            `
        );

    res.json(
        result.rows
    );
});

app.get(
    '/api/historico/:device',
    async (req, res) =>
{
    try
    {
        const result =
            await pool.query(
                `
                SELECT *
                FROM telemetria
                WHERE device = $1
                ORDER BY id DESC
                LIMIT 100
                `,
                [req.params.device]
            );

        res.json(
            result.rows
        );
    }
    catch(err)
    {
        res.status(500).json({
            erro: err.message
        });
    }
});