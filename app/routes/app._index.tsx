import { useEffect, useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import crypto from "crypto";
import { createAppWithSettings, renameApp, deleteAppWithData } from "~/services/app.service.server";
import {
  Page,
  Card,
  Button,
  Modal,
  TextField,
  EmptyState,
  Layout,
  Text,
  BlockStack,
  InlineStack,
  Box,
  ResourceList,
  ResourceItem,
  Badge,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { ClientOnly } from "~/components/ClientOnly";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authenticate) {
    throw new Response("Shopify configuration not found", { status: 500 });
  }
  
  const { session, redirect } = await authenticate.admin(request);
  const shop = session.shop;

  let user = await prisma.user.findUnique({
    where: { email: shop },
  });

  if (!user) {
    const { generateRandomPassword } = await import("~/lib/crypto.server");
    user = await prisma.user.create({
      data: {
        email: shop,
        password: generateRandomPassword(),
      },
    });
  }

  const apps = await prisma.app.findMany({
    where: { userId: user.id },
    include: {
      _count: {
        select: { events: true, analyticsSessions: true },
      },
      settings: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Calculate aggregated dashboard stats
  const totalPixels = apps.length;
  const totalEvents = apps.reduce((sum, app) => sum + app._count.events, 0);
  const totalSessions = apps.reduce((sum, app) => sum + app._count.analyticsSessions, 0);
  
  // Get recent events across all apps (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const recentEvents = await prisma.event.findMany({
    where: {
      app: {
        userId: user.id,
      },
      createdAt: { gte: sevenDaysAgo },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      app: {
        select: { name: true, appId: true },
      },
    },
  });

  // Calculate today's stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayEvents = await prisma.event.count({
    where: {
      app: {
        userId: user.id,
      },
      createdAt: { gte: today },
    },
  });

  // Always show the dashboard at /app
  return { 
    shop, 
    userId: user.id, 
    apps,
    stats: {
      totalPixels,
      totalEvents,
      totalSessions,
      todayEvents,
    },
    recentEvents: recentEvents.map(e => ({
      id: e.id,
      eventName: e.eventName,
      url: e.url,
      appName: e.app.name,
      appId: e.app.appId,
      createdAt: e.createdAt,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authenticate) {
    throw new Response("Shopify configuration not found", { status: 500 });
  }
  
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const user = await prisma.user.findUnique({
    where: { email: shop },
  });

  if (!user) {
    return { error: "User not found" };
  }

  try {
    if (intent === "create") {
      const name = formData.get("name") as string;
      const metaAppId = formData.get("metaAppId") as string;
      const metaAccessToken = formData.get("metaAccessToken") as string;

      if (!name || !metaAppId || !metaAccessToken) {
        return { error: "All fields are required: App Name, Dataset ID, and Access Token" };
      }

      const result = await createAppWithSettings({
        userId: user.id,
        name,
        metaAppId,
        metaAccessToken,
      });

      // Get app with counts for response
      const app = await prisma.app.findUnique({
        where: { id: result.app.id },
        include: {
          _count: {
            select: { events: true, analyticsSessions: true },
          },
          settings: true,
        },
      });

      return { success: true, app, intent: "create" };
    }

    if (intent === "rename") {
      const appId = formData.get("appId") as string;
      const newName = formData.get("newName") as string;

      if (!newName) {
        return { error: "Name is required" };
      }

      await renameApp(appId, newName);

      return { success: true, intent: "rename" };
    }

    if (intent === "delete") {
      const appId = formData.get("appId") as string;

      await deleteAppWithData(appId);

      return { success: true, intent: "delete" };
    }

    return { error: "Invalid intent" };
  } catch (error: any) {
    console.error("Action error:", error);
    return { error: error.message || "An error occurred" };
  }
};

export default function Index() {
  const { apps, stats, recentEvents } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<any>(null);
  const [showSnippet, setShowSnippet] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: "",
    datasetId: "", // Dataset ID = App ID
    accessToken: "",
  });
  const [createError, setCreateError] = useState("");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validatedDatasetName, setValidatedDatasetName] = useState("");

  // Rename form state
  const [renameValue, setRenameValue] = useState("");

  const isLoading = fetcher.state !== "idle";

  // For embedded apps, we should redirect in the loader, not client-side
  // This component will show the dashboard, but analytics is the default view
  // The redirect happens in the loader if needed

  // Fetch analytics for selected app
  useEffect(() => {
    if (selectedApp) {
      fetch(`/api/analytics?appId=${selectedApp}&range=7d`)
        .then((res) => res.json())
        .then((data) => {
          if (!data.error) {
            setAnalytics(data);
          }
        })
        .catch(console.error);
    }
  }, [selectedApp]);

  // Validate Meta credentials using Dataset ID (App ID) and Access Token
  const validateCredentials = useCallback(async () => {
    if (!createForm.datasetId) {
      setCreateError("Please enter Dataset ID (App ID)");
      return;
    }
    if (!createForm.accessToken) {
      setCreateError("Please enter Access Token");
      return;
    }

    setValidating(true);
    setCreateError("");

    try {
      const response = await fetch("/api/meta/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: createForm.datasetId,
          accessToken: createForm.accessToken,
        }),
      });

      const data = await response.json();

      if (data.valid) {
        setValidated(true);
        setValidatedDatasetName(data.datasetName || "");
        setCreateError("");
        // Auto-fill app name if empty and we got a dataset name
        if (!createForm.name && data.datasetName) {
          setCreateForm(prev => ({ ...prev, name: data.datasetName }));
        }
      } else {
        setValidated(false);
        setValidatedDatasetName("");
        setCreateError(data.error || "Invalid credentials. Please check your Dataset ID and Access Token.");
      }
    } catch {
      setCreateError("Failed to validate credentials");
      setValidated(false);
    } finally {
      setValidating(false);
    }
  }, [createForm.datasetId, createForm.accessToken, createForm.name]);

  const handleCreate = useCallback(() => {
    if (!createForm.name) {
      setCreateError("App name is required");
      return;
    }
    if (!createForm.datasetId) {
      setCreateError("Dataset ID (App ID) is required");
      return;
    }
    if (!createForm.accessToken) {
      setCreateError("Access Token is required");
      return;
    }
    if (!validated) {
      setCreateError("Please validate your credentials first");
      return;
    }

    fetcher.submit(
      {
        intent: "create",
        name: createForm.name,
        metaAppId: createForm.datasetId, // Dataset ID = App ID
        metaAccessToken: createForm.accessToken,
      },
      { method: "POST" }
    );
    setShowCreateModal(false);
    setCreateForm({ name: "", datasetId: "", accessToken: "" });
    setValidated(false);
    setValidatedDatasetName("");
    setCreateError("");
  }, [fetcher, createForm, validated]);

  const handleRename = useCallback(() => {
    if (!renameValue.trim()) return;
    
    fetcher.submit(
      { intent: "rename", appId: showRenameModal.id, newName: renameValue },
      { method: "POST" }
    );
    setShowRenameModal(null);
    setRenameValue("");
  }, [fetcher, showRenameModal, renameValue]);

  const handleDelete = useCallback(() => {
    fetcher.submit(
      { intent: "delete", appId: showDeleteModal.id },
      { method: "POST" }
    );
    setShowDeleteModal(null);
  }, [fetcher, showDeleteModal]);

  const handleCreateModalClose = useCallback(() => {
    setShowCreateModal(false);
    setCreateForm({ name: "", datasetId: "", accessToken: "" });
    setValidated(false);
    setValidatedDatasetName("");
    setCreateError("");
  }, []);

  const [snippetText, setSnippetText] = useState("");

  useEffect(() => {
    if (showSnippet && typeof window !== "undefined") {
      const origin = window.location.origin;
      setSnippetText(`<!-- Pixel Analytics -->
<script>
  window.PIXEL_APP_ID = "${showSnippet}";
</script>
<script async src="${origin}/api/pixel.js?id=${showSnippet}"></script>`);
    }
  }, [showSnippet]);

  const copyToClipboard = useCallback(() => {
    if (snippetText) {
      navigator.clipboard.writeText(snippetText);
    }
  }, [snippetText]);

  return (
    <ClientOnly
      fallback={
        <Page title="Pixel Analytics">
          <Layout>
            <Layout.Section>
              <Card>
                <Text as="p">Loading...</Text>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      }
    >
      <Page
        title="Dashboard"
        primaryAction={{
          content: "Create Pixel",
          onAction: () => setShowCreateModal(true),
        }}
      >
        <Layout>
          {/* Dashboard Overview Stats */}
          <Layout.Section>
            <BlockStack gap="400">
              <Text variant="headingLg" as="h2">
                Overview
              </Text>
              <InlineStack gap="400" wrap={false}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodySm" as="p" tone="subdued">
                      Total Pixels
                    </Text>
                    <Text variant="headingXl" as="p">
                      {stats.totalPixels}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodySm" as="p" tone="subdued">
                      Total Events
                    </Text>
                    <Text variant="headingXl" as="p">
                      {stats.totalEvents.toLocaleString()}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodySm" as="p" tone="subdued">
                      Total Sessions
                    </Text>
                    <Text variant="headingXl" as="p">
                      {stats.totalSessions.toLocaleString()}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodySm" as="p" tone="subdued">
                      Events Today
                    </Text>
                    <Text variant="headingXl" as="p">
                      {stats.todayEvents.toLocaleString()}
                    </Text>
                  </BlockStack>
                </Card>
              </InlineStack>
            </BlockStack>
          </Layout.Section>

          {/* Recent Events */}
          {recentEvents.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">
                    Recent Events
                  </Text>
                  <BlockStack gap="200">
                    {recentEvents.map((event: any) => (
                      <InlineStack key={event.id} align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Badge>{event.eventName}</Badge>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {event.appName}
                            </Text>
                          </InlineStack>
                          {event.url && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {new URL(event.url).pathname}
                            </Text>
                          )}
                        </BlockStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {new Date(event.createdAt).toLocaleString()}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Pixels List */}
          <Layout.Section>
            <BlockStack gap="400">
              <Text variant="headingLg" as="h2">
                Your Pixels
              </Text>
              {apps.length === 0 ? (
                <Card>
                  <EmptyState
                    heading="No tracking pixels yet"
                    action={{
                      content: "Create Your First Pixel",
                      onAction: () => setShowCreateModal(true),
                    }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Create your first tracking pixel with Meta Pixel integration
                      to start collecting analytics data.
                    </p>
                  </EmptyState>
                </Card>
              ) : (
                <Card>
                  <ResourceList
                    resourceName={{ singular: "pixel", plural: "pixels" }}
                    items={apps}
                    renderItem={(app: any) => {
                      const { id, appId, name, _count, settings } = app;
                      return (
                        <ResourceItem id={id} onClick={() => {}}>
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <BlockStack gap="100">
                                <InlineStack gap="200" blockAlign="center">
                                  <Text variant="bodyMd" fontWeight="bold" as="h3">
                                    {name}
                                  </Text>
                                  {settings?.metaPixelEnabled && (
                                    <Badge tone="success">Meta Connected</Badge>
                                  )}
                                </InlineStack>
                                <Text variant="bodySm" as="p" tone="subdued">
                                  Pixel ID: {appId} • {_count.events.toLocaleString()} events •{" "}
                                  {_count.analyticsSessions.toLocaleString()} sessions
                                </Text>
                              </BlockStack>
                              <InlineStack gap="200">
                                {settings?.metaPixelEnabled ? (
                                  <Button variant="primary" url={`/app/analytics?appId=${appId}`}>
                                    Go to Dashboard
                                  </Button>
                                ) : (
                                  <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                                    Connect Meta
                                  </Button>
                                )}
                                <Button
                                  onClick={() =>
                                    setSelectedApp(selectedApp === appId ? null : appId)
                                  }
                                >
                                  {selectedApp === appId ? "Hide Stats" : "View Stats"}
                                </Button>
                                <Button onClick={() => setShowSnippet(appId)}>
                                  Get Code
                                </Button>
                                <Button
                                  onClick={() => {
                                    setShowRenameModal(app);
                                    setRenameValue(app.name);
                                  }}
                                >
                                  Rename
                                </Button>
                                <Button
                                  tone="critical"
                                  onClick={() => setShowDeleteModal(app)}
                                >
                                  Delete
                                </Button>
                              </InlineStack>
                            </InlineStack>
                          </BlockStack>
                        </ResourceItem>
                      );
                    }}
                  />
                </Card>
              )}
            </BlockStack>
          </Layout.Section>

          {/* Detailed Analytics for Selected Pixel */}
          {selectedApp && analytics && (
                <Layout.Section>
                  <BlockStack gap="400">
                    <Text variant="headingLg" as="h2">
                      Analytics Overview (Last 7 Days)
                    </Text>

                    <InlineStack gap="400" wrap={false}>
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" as="p" tone="subdued">
                            Total Events
                          </Text>
                          <Text variant="headingLg" as="p">
                            {analytics.overview?.totalEvents?.toLocaleString() || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" as="p" tone="subdued">
                            Pageviews
                          </Text>
                          <Text variant="headingLg" as="p">
                            {analytics.overview?.pageviews?.toLocaleString() || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" as="p" tone="subdued">
                            Unique Visitors
                          </Text>
                          <Text variant="headingLg" as="p">
                            {analytics.overview?.uniqueVisitors?.toLocaleString() || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" as="p" tone="subdued">
                            Sessions
                          </Text>
                          <Text variant="headingLg" as="p">
                            {analytics.overview?.sessions?.toLocaleString() || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                    </InlineStack>

                    {analytics.topPages?.length > 0 && (
                      <Card>
                        <BlockStack gap="400">
                          <Text variant="headingMd" as="h3">
                            Top Pages
                          </Text>
                          <BlockStack gap="200">
                            {analytics.topPages
                              .slice(0, 5)
                              .map((page: any, idx: number) => (
                                <InlineStack key={idx} align="space-between">
                                  <Text as="p">
                                    {page.url ? new URL(page.url).pathname : "-"}
                                  </Text>
                                  <Text as="p" tone="subdued">
                                    {page.count} views
                                  </Text>
                                </InlineStack>
                              ))}
                          </BlockStack>
                        </BlockStack>
                      </Card>
                    )}

                    {analytics.topCountries?.length > 0 && (
                      <Card>
                        <BlockStack gap="400">
                          <Text variant="headingMd" as="h3">
                            Top Countries
                          </Text>
                          <BlockStack gap="200">
                            {analytics.topCountries
                              .slice(0, 5)
                              .map((country: any, idx: number) => (
                                <InlineStack key={idx} align="space-between">
                                  <Text as="p">{country.country || "Unknown"}</Text>
                                  <Text as="p" tone="subdued">
                                    {country.count} visits
                                  </Text>
                                </InlineStack>
                              ))}
                          </BlockStack>
                        </BlockStack>
                      </Card>
                    )}
                  </BlockStack>
                </Layout.Section>
              )}
        </Layout>

        {/* Create Modal */}
        <Modal
          open={showCreateModal}
          onClose={handleCreateModalClose}
          title="Create New Pixel"
          primaryAction={{
            content: "Create Pixel",
            onAction: handleCreate,
            loading: isLoading,
            disabled: !validated || !createForm.name,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: handleCreateModalClose,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {createError && (
                <Banner tone="critical">
                  <p>{createError}</p>
                </Banner>
              )}

              {validated && (
                <Banner tone="success">
                  <BlockStack gap="200">
                    <Text as="p">✓ Credentials verified successfully!</Text>
                    {validatedDatasetName && (
                      <Text as="p" variant="bodySm">
                        Dataset Name: {validatedDatasetName}
                      </Text>
                    )}
                  </BlockStack>
                </Banner>
              )}

              <FormLayout>
                <TextField
                  label="App Name"
                  value={createForm.name}
                  onChange={(value) =>
                    setCreateForm((prev) => ({ ...prev, name: value }))
                  }
                  placeholder="e.g., My Store Pixel"
                  helpText="Name for your pixel in this app. Will be auto-filled from Meta dataset name if left empty."
                  autoComplete="off"
                />

                <TextField
                  label="Dataset ID (App ID)"
                  value={createForm.datasetId}
                  onChange={(value) => {
                    setCreateForm((prev) => ({ ...prev, datasetId: value }));
                    setValidated(false);
                  }}
                  placeholder="e.g., 1234567890123456"
                  helpText="Find in Meta Events Manager → Data Sources → Select your dataset → Dataset ID"
                  autoComplete="off"
                  requiredIndicator
                />

                <TextField
                  label="Access Token"
                  value={createForm.accessToken}
                  onChange={(value) => {
                    setCreateForm((prev) => ({ ...prev, accessToken: value }));
                    setValidated(false);
                  }}
                  type="password"
                  placeholder="EAAxxxxxxxx..."
                  helpText="Generate in Meta Events Manager → Settings → Conversions API → Generate Access Token"
                  autoComplete="off"
                  requiredIndicator
                />
              </FormLayout>

              <Button
                onClick={validateCredentials}
                loading={validating}
                disabled={!createForm.datasetId || !createForm.accessToken}
              >
                Validate Credentials
              </Button>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Rename Modal */}
        {showRenameModal && (
          <Modal
            open={true}
            onClose={() => {
              setShowRenameModal(null);
              setRenameValue("");
            }}
            title="Rename Pixel"
            primaryAction={{
              content: "Save",
              onAction: handleRename,
              loading: isLoading,
              disabled: !renameValue.trim(),
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => {
                  setShowRenameModal(null);
                  setRenameValue("");
                },
              },
            ]}
          >
            <Modal.Section>
              <TextField
                label="New Name"
                value={renameValue}
                onChange={setRenameValue}
                autoComplete="off"
                autoFocus
              />
            </Modal.Section>
          </Modal>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <Modal
            open={true}
            onClose={() => setShowDeleteModal(null)}
            title="Delete Pixel"
            primaryAction={{
              content: "Delete",
              onAction: handleDelete,
              loading: isLoading,
              destructive: true,
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => setShowDeleteModal(null),
              },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <Banner tone="critical">
                  <p>
                    Are you sure you want to delete "{showDeleteModal.name}"? This
                    will permanently delete all associated events, sessions, and
                    data. This action cannot be undone.
                  </p>
                </Banner>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}

        {/* Snippet Modal */}
        {showSnippet && (
          <Modal
            open={true}
            onClose={() => setShowSnippet(null)}
            title="Install Tracking Code"
            primaryAction={{
              content: "Copy Code",
              onAction: copyToClipboard,
            }}
            secondaryActions={[
              {
                content: "Close",
                onAction: () => setShowSnippet(null),
              },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <Text as="p">
                  Add this code to your store's theme, just before the closing
                  &lt;/head&gt; tag:
                </Text>
                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "12px",
                      whiteSpace: "pre-wrap",
                      overflowX: "auto",
                    }}
                  >
                    {snippetText}
                  </div>
                </Box>
                <Text as="p" tone="subdued">
                  For Shopify themes: Go to Online Store → Themes → Edit code →
                  theme.liquid
                </Text>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </Page>
    </ClientOnly>
  );
}

