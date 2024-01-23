import { PrismaClient } from '@prisma/client';
import express from 'express';
import { compare, crypt } from '../password';
import jwt from 'jsonwebtoken';
import http from 'http'
import { Server } from 'socket.io'

const app = express();
const port = 21127;

const server = http.createServer(app);
const io = new Server(server)

const prisma = new PrismaClient()

enum Rules {
    user = "user",
    admin = "admin"
}

async function main() {
    app.use(express.json())
    app.use(express.urlencoded({ extended: true}))

    app.post("/login", async (req, res) => {
        const name = req.body.name
        const password = req.body.password

        const user = await prisma.user.findUnique({
            where: {
                name,
            },
            select: {
                guid: true,
                name: true,
                password: true,
            }
        })

        console.log(user)

        if(!user){
            return res.json({
                error: "Usuario não encontrado"
            })
        }

        const isPasswordCorrect = await compare(password, user.password)
        if(!isPasswordCorrect){
            return res.json({
                error: "Usuario não encontrado"
            })  
        }

        const token = jwt.sign({ rules: [Rules.user] }, process.env.JWT_SECRET ?? "")

        res.json({name: user.name, guid: user.guid, token})
    })

    app.post("/register", async (req, res) => {
        const password = await crypt(req.body.password)

        const user = await prisma.user.create({
            data: {
                name: req.body.name,
                password
            },
            select: {
                guid: true,
                name: true,
            }
        })
        res.json(user)
    })

    app.post("/reboot", (req, res) => {
        io.to(req.body.guid).emit("reboot")
        res.send("ok")
    })

    io.on('connection', (socket) => {
        console.log('user connected');

        socket.on("user", (guid) => {
            console.log(guid)
            socket.join(guid)
        })

        socket.on('disconnect', function () {
          console.log('user disconnected');
        });
      })

    server.listen(port, () => {
        console.log("running on port "+port)
    })
}

main()

  .then(async () => {

    await prisma.$disconnect()

  })

  .catch(async (e) => {

    console.error(e)

    await prisma.$disconnect()

    process.exit(1)

  })