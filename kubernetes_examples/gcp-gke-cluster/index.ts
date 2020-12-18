import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const name = "shaht-cluster";

const config = new pulumi.Config();
const clusterConfig = new pulumi.StackReference("shaht/gcp-py-network-component/dev");

export const masterVersion = config.get("masterVersion") ||
    gcp.container.getEngineVersions().then(it => it.latestMasterVersion);

// Create a GKE cluster
const cluster = new gcp.container.Cluster(name, {
    // We can't create a cluster with no node pool defined, but we want to only use
    // separately managed node pools. So we create the smallest possible default
    // node pool and immediately delete it.
    initialNodeCount: 1,
    removeDefaultNodePool: true,
    //ipAllocationPolicy: ["10.0.0.0/25","10.0.0.128/25"],
    minMasterVersion: masterVersion,
    network: clusterConfig.getOutput("network"),
    subnetwork: clusterConfig.getOutput("subnets_names_string"),
    //subnetwork: clusterConfig.getOutput("subnets_cidr_blocks_string"),
    ipAllocationPolicy: {
      clusterIpv4CidrBlock: clusterConfig.getOutput("10.0.0.0/25"),
    },
});

const nodePool = new gcp.container.NodePool(`primary-node-pool`, {
    cluster: cluster.name,
    initialNodeCount: 3,
    location: cluster.location,
    autoscaling: {maxNodeCount: 9, minNodeCount: 3},
    management: {autoRepair: true},
    nodeConfig: {
        preemptible: true,
        machineType: "n1-standard-1",
        oauthScopes: [
            "https://www.googleapis.com/auth/compute",
            "https://www.googleapis.com/auth/devstorage.read_only",
            "https://www.googleapis.com/auth/logging.write",
            "https://www.googleapis.com/auth/monitoring",
        ],
    },
    version: masterVersion,

  },

  {
    dependsOn: [cluster],
  });
// Export the Cluster name
export const clusterName = cluster.name;

// Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
// because of the way GKE requires gcloud to be in the picture for cluster
// authentication (rather than using the client cert/key directly).
export const kubeconfig = pulumi.
    all([ cluster.name, cluster.endpoint, cluster.masterAuth ]).
    apply(([ name, endpoint, masterAuth ]) => {
        const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
    });

// Create a Kubernetes provider instance that uses our cluster from above.
const clusterProvider = new k8s.Provider(name, {
    kubeconfig: kubeconfig,
});