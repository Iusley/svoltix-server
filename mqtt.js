const mqtt = require('mqtt');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'svoltix',
    password: 'admin',
    port: 5432
});

const client =
    mqtt.connect(
        'mqtt://localhost:1883'
    );

client.on(
    'connect',
    () =>
    {
        console.log(
            'MQTT CONECTADO'
        );

        client.subscribe(
            'svoltix/pulse/#'
        );
    }
);

client.on(
    'message',
    async (topic, message) =>
    {
        try
        {
            const d =
                JSON.parse(
                    message.toString()
                );

            await pool.query(
                `
                INSERT INTO telemetria
                (
                    device,

                    va,vb,vc,
                    vab,vbc,vca,

                    ia,ib,ic,

                    fpa,fpb,fpc,fpt,

                    hz,

                    pa,pb,pc,pt,

                    sa,sb,sc,st,

                    qa,qb,qc,

                    tc,
                    uptime
                )
                VALUES
                (
                    $1,

                    $2,$3,$4,
                    $5,$6,$7,

                    $8,$9,$10,

                    $11,$12,$13,$14,

                    $15,

                    $16,$17,$18,$19,

                    $20,$21,$22,$23,

                    $24,$25,$26,

                    $27,
                    $28
                )
                `,
                [
                    d.device,

                    d.va,
                    d.vb,
                    d.vc,

                    d.vab,
                    d.vbc,
                    d.vca,

                    d.ia,
                    d.ib,
                    d.ic,

                    d.fpa,
                    d.fpb,
                    d.fpc,
                    d.fpt,

                    d.hz,

                    d.pa,
                    d.pb,
                    d.pc,
                    d.pt,

                    d.sa,
                    d.sb,
                    d.sc,
                    d.st,

                    d.qa,
                    d.qb,
                    d.qc,

                    d.tc,
                    d.uptime
                ]
            );

            console.log(
                'GRAVADO:',
                d.device,
                d.pt,
                'W'
            );
        }
        catch(err)
        {
            console.log(
                'ERRO:',
                err.message
            );
        }
    }
);