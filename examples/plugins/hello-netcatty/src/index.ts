import { definePlugin } from "@netcatty/plugin-sdk";

export default definePlugin({
  activate(context) {
    context.logger.info("Hello Netcatty example activated", {
      pluginId: context.pluginId,
    });
    context.subscriptions.add(context.commands.registerCommand(
      "com.netcatty.hello.sayHello",
      async () => {
        const greeting = await context.settings.get<string>("com.netcatty.hello.greeting");
        context.logger.info(greeting ?? "Hello from Netcatty");
        return { greeting: greeting ?? "Hello from Netcatty" };
      },
    ));
    context.subscriptions.add(context.providers.register(
      "com.netcatty.hello.completion",
      "terminal.completion",
      ({ payload }) => {
        const { input } = payload;
        return input && "netcatty-hello".startsWith(input)
          ? { items: [{ text: "netcatty-hello", score: 5_000 }] }
          : { items: [] };
      },
    ));
    context.subscriptions.add(context.providers.register(
      "com.netcatty.hello.decoration",
      "terminal.decoration",
      () => ({
        rules: [{
          id: "greeting",
          label: "Netcatty greeting",
          patterns: ["\\bHello from Netcatty\\b"],
          color: "#34D399",
        }],
      }),
    ));
    context.subscriptions.add(context.providers.register(
      "com.netcatty.hello.theme",
      "terminal.theme",
      () => ({ colors: { cursor: "#34D399" } }),
    ));
  },
});
