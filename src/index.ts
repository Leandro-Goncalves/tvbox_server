import { PrismaClient } from "@prisma/client";
import express from "express";
import { compare, crypt } from "../password";
import jwt from "jsonwebtoken";
import https from "https";
import { Server } from "socket.io";
import dayjs from "dayjs";
import cors from "cors";
import * as fs from "fs";
import path from "path";

var privateKey = fs.readFileSync(path.join(__dirname, "../", "key.pem"));
var certificate = fs.readFileSync(path.join(__dirname, "../", "cert.pem"));

const DAYS_TO_WARNING = 7;

const app = express();
app.use(cors());
const port = 21127;

const server = https.createServer(
  {
    key: privateKey,
    cert: certificate,
  },
  app
);
const io = new Server(server);

const prisma = new PrismaClient();

enum Rules {
  user = "user",
  admin = "admin",
}

async function main() {
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post("/user/:guid/expire/month", async (req, res) => {
    const guid = req.params.guid;

    const month = req.body.month;

    const user = await prisma.user.findUnique({
      where: {
        guid,
      },
    });

    if (!user) {
      return res.json({});
    }

    await prisma.user.update({
      where: {
        guid,
      },
      data: {
        expirationDate: dayjs(user.expirationDate)
          .add(month, "month")
          .toISOString(),
      },
    });
    return res.json({});
  });

  app.post("/user/:guid/expire/day", async (req, res) => {
    const guid = req.params.guid;

    const days = req.body.days;

    const user = await prisma.user.findUnique({
      where: {
        guid,
      },
    });

    if (!user) {
      return res.json({});
    }

    await prisma.user.update({
      where: {
        guid,
      },
      data: {
        expirationDate: dayjs(user.expirationDate)
          .add(days, "day")
          .toISOString(),
      },
    });
    return res.json({});
  });

  app.delete("/user/:guid", async (req, res) => {
    const guid = req.params.guid;

    await prisma.user.delete({
      where: {
        guid: guid,
      },
    });

    return res.json({});
  });

  app.post("/login", async (req, res) => {
    const name = req.body.name;
    const password = req.body.password;

    console.log("login", name, password);

    const user = await prisma.user.findUnique({
      where: {
        name,
      },
      select: {
        guid: true,
        name: true,
        password: true,
      },
    });

    console.log(user);

    if (!user) {
      return res.json({
        error: "Usuario não encontrado",
      });
    }

    const isPasswordCorrect = await compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.json({
        error: "Usuario não encontrado",
      });
    }

    const token = jwt.sign(
      { rules: [Rules.user] },
      process.env.JWT_SECRET ?? ""
    );

    res.json({ name: user.name, guid: user.guid, token });
  });

  app.post("/register", async (req, res) => {
    const password = await crypt(req.body.password);

    const user = await prisma.user.create({
      data: {
        name: req.body.name,
        password,
      },
      select: {
        guid: true,
        name: true,
      },
    });
    res.json(user);
  });

  app.post("/user/:guid/block", async (req, res) => {
    const guid = req.params.guid;
    const isBlocked = req.body.isBlocked === true;

    await prisma.user.update({
      where: {
        guid,
      },
      data: {
        isBlocked,
      },
    });
    if (isBlocked) {
      io.to(guid).emit("reboot");
    }
    res.send("ok");
  });

  app.get("/users", async (req, res) => {
    const users = await prisma.user.findMany({
      select: {
        guid: true,
        name: true,
        isLogged: true,
        isBlocked: true,
        expirationDate: true,
        userApp: {
          select: {
            guid: true,
            name: true,
            startAt: true,
          },
        },
      },
    });
    res.json(users.map((user) => ({ ...user, userApp: user.userApp[0] })));
  });

  app.post("/reboot", (req, res) => {
    io.to(req.body.guid).emit("reboot");
    res.send("ok");
  });

  io.on("connection", (socket) => {
    console.log("user connected");

    socket.on("user", async (guid) => {
      console.log(guid);

      await prisma.user.update({
        where: {
          guid,
        },
        data: {
          isLogged: true,
        },
      });

      socket.join(guid);
      socket.data.guid = guid;

      socket.on("removeApp", async function () {
        console.log("user remove app");
        const userApp = await prisma.userApp.findUnique({
          where: {
            userGuid: guid,
          },
        });

        if (userApp) {
          await prisma.userApp.delete({
            where: {
              userGuid: guid,
            },
          });
        }
      });

      socket.on("openApp", async function (name: string) {
        console.log("user update", name);
        await prisma.userApp.upsert({
          where: {
            userGuid: guid,
          },
          create: {
            name,
            startAt: new Date(),
            userGuid: guid,
          },
          update: {
            name,
            startAt: new Date(),
            userGuid: guid,
          },
        });
      });

      const user = await prisma.user.findUnique({
        where: {
          guid,
        },
      });

      if (!user) {
        socket.emit("expired");
        return;
      }

      console.log(user.name, user.isBlocked);
      if (user.isBlocked) {
        socket.emit("expired");
        return;
      }

      if (user.expirationDate < new Date()) {
        socket.emit("expired");
        return;
      }

      if (
        dayjs(new Date())
          .add(DAYS_TO_WARNING, "day")
          .isAfter(user.expirationDate)
      ) {
        socket.emit(
          "warning",
          dayjs(user.expirationDate).diff(new Date(), "day")
        );
        return;
      }
    });

    socket.on("disconnect", async function () {
      console.log("disconnect", socket.data.guid);
      await prisma.user.update({
        where: {
          guid: socket.data.guid,
        },
        data: {
          isLogged: false,
        },
      });

      await prisma.userApp.deleteMany({
        where: {
          userGuid: socket.data.guid,
        },
      });
    });
  });

  server.listen(port, () => {
    console.log("running on port " + port);
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })

  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
