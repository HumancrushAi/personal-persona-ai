import { createServerFn } from "@tanstack/react-start";

export const getPaymentConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    clientKey: process.env.AUTHORIZE_NET_CLIENT_KEY ?? "",
    apiLoginId: process.env.AUTHORIZE_NET_API_LOGIN_ID ?? "",
  };
});
