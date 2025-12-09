import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const [isInIframe, setIsInIframe] = useState(false);
  const { errors } = actionData || loaderData;

  // Check if we're in an iframe and redirect to top level if needed
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const inIframe = window.top !== window.self;
        setIsInIframe(inIframe);
        
        // If in iframe, try to redirect the top window to this URL
        // Only works if same-origin, will fail silently if cross-origin
        if (inIframe && window.top) {
          try {
            // Check if we can access window.top.location (same-origin check)
            const topLocation = window.top.location;
            // If we get here, we're same-origin, so redirect is safe
            topLocation.href = window.location.href;
          } catch (e) {
            // Cross-origin iframe - can't break out, this is expected for Shopify embedded apps
            // The Form has target="_top" which will handle the redirect properly
            setIsInIframe(false);
          }
        }
      } catch (e) {
        // Silently handle any errors
        setIsInIframe(false);
      }
    }
  }, []);

  // Don't render anything if we're redirecting from an iframe
  if (isInIframe) {
    return (
      <AppProvider embedded={false}>
        <div style={{ padding: "40px", textAlign: "center" }}>
          <p>Redirecting to login...</p>
        </div>
      </AppProvider>
    );
  }

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post" target="_top">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
