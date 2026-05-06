import app from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  console.log(`Server berjalan di http://localhost:${env.port}`);
});
