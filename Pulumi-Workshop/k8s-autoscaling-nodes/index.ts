import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { eksStack, eks_cluster_name,kubeconfig,k8sProvider,projectName,stackName, } from "./common";

const metricsnamespace = new k8s.core.v1.Namespace("metrics-Namespace", {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
        name: "metrics",
    },
}, { provider: k8sProvider });

//URL of chart:  https://github.com/bitnami/bitnami-docker-metrics-server
//Helm Chart options: https://artifacthub.io/packages/helm/bitnami/metrics-server
// The values were picked from here: https://github.com/bitnami/charts/blob/master/bitnami/metrics-server/values.yaml
const metricsserver = new k8s.helm.v3.Chart("metricschart",  {
    version: "5.3.3",
    namespace: metricsnamespace.metadata.name,
    chart: "metrics-server",
    fetchOpts: {
        repo: "https://charts.bitnami.com/bitnami",
    },
    values: { 
              rbac: {create: true},
              apiService: {create: true},
            },
}, { provider: k8sProvider });

export const tag_cluster_autoscaler_enabled_label = '"k8s.io/cluster-autoscaler/enabled"';
export const my_eks_cluster_name = eks_cluster_name;

export const tag_cluster_autoscaler_eks_name = pulumi.interpolate`k8s.io/cluster-autoscaler/${eks_cluster_name}`;

export const tag_cluster_autoscaler_autodiscovery_label = tag_cluster_autoscaler_eks_name.apply(myekspart => {
    return JSON.stringify(`${myekspart}`);
  });

const clusterautoscaler = new k8s.helm.v3.Chart("autoscale",  {
    version: "9.3.0",
    namespace: "kube-system",
    chart: "cluster-autoscaler",
    fetchOpts: {
        repo: "https://kubernetes.github.io/autoscaler",
    },
     values: {
              rbac: {create:true},
              extraArgs: {"stderrthreshold":"info","skip-nodes-with-local-storage":false,"expander":"least-waste","balance-similar-node-groups":true,"skip-nodes-with-system-pods":false,},
              autoDiscovery: {clusterName: eks_cluster_name, tags: [tag_cluster_autoscaler_enabled_label,tag_cluster_autoscaler_autodiscovery_label]},
            },
}, { provider: k8sProvider });

const go_demo_5Namespace = new k8s.core.v1.Namespace("go_demo_5Namespace", {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
        name: "go-demo-5",
    },
}, { provider: k8sProvider });
    
const go_demo_5ApiIngress = new k8s.networking.v1beta1.Ingress("go_demo_5ApiIngress", {
    apiVersion: "networking.k8s.io/v1beta1",
    kind: "Ingress",
    metadata: {
        name: "api",
        namespace: "go-demo-5",
        annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "ingress.kubernetes.io/ssl-redirect": "false",
            "nginx.ingress.kubernetes.io/ssl-redirect": "false",
        },
    },
    spec: {
        rules: [{
            http: {
                paths: [{
                    path: "/demo",
                    backend: {
                        serviceName: "api",
                        servicePort: 8080,
                    },
                }],
            },
        }],
    },
}, { provider: k8sProvider });

const go_demo_5DbServiceAccount = new k8s.core.v1.ServiceAccount("go_demo_5DbServiceAccount", {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
        name: "db",
        namespace: "go-demo-5",
    },
}, { provider: k8sProvider });

const go_demo_5DbRole = new k8s.rbac.v1beta1.Role("go_demo_5DbRole", {
    kind: "Role",
    apiVersion: "rbac.authorization.k8s.io/v1beta1",
    metadata: {
        name: "db",
        namespace: "go-demo-5",
    },
    rules: [{
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["list"],
    }],
}, { provider: k8sProvider });

const go_demo_5DbRoleBinding = new k8s.rbac.v1beta1.RoleBinding("go_demo_5DbRoleBinding", {
    apiVersion: "rbac.authorization.k8s.io/v1beta1",
    kind: "RoleBinding",
    metadata: {
        name: "db",
        namespace: "go-demo-5",
    },
    roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: "db",
    },
    subjects: [{
        kind: "ServiceAccount",
        name: "db",
    }],
}, { provider: k8sProvider });

const go_demo_5DbStatefulSet = new k8s.apps.v1.StatefulSet("go_demo_5DbStatefulSet", {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: {
        name: "db",
        namespace: "go-demo-5",
    },
    spec: {
        serviceName: "db",
        selector: {
            matchLabels: {
                app: "db",
            },
        },
        template: {
            metadata: {
                labels: {
                    app: "db",
                },
            },
            spec: {
                serviceAccountName: "db",
                terminationGracePeriodSeconds: 10,
                containers: [
                    {
                        name: "db",
                        image: "mongo:3.3",
                        command: [
                            "mongod",
                            "--replSet",
                            "rs0",
                            "--smallfiles",
                            "--noprealloc",
                        ],
                        ports: [{
                            containerPort: 27017,
                        }],
                        resources: {
                            limits: {
                                memory: "150Mi",
                                cpu: "0.2",
                            },
                            requests: {
                                memory: "100Mi",
                                cpu: "0.1",
                            },
                        },
                        volumeMounts: [{
                            name: "mongo-data",
                            mountPath: "/data/db",
                        }],
                    },
                    {
                        name: "db-sidecar",
                        image: "cvallance/mongo-k8s-sidecar",
                        env: [
                            {
                                name: "MONGO_SIDECAR_POD_LABELS",
                                value: "app=db",
                            },
                            {
                                name: "KUBE_NAMESPACE",
                                value: "go-demo-5",
                            },
                            {
                                name: "KUBERNETES_MONGO_SERVICE_NAME",
                                value: "db",
                            },
                        ],
                        resources: {
                            limits: {
                                memory: "100Mi",
                                cpu: "0.2",
                            },
                            requests: {
                                memory: "50Mi",
                                cpu: "0.1",
                            },
                        },
                    },
                ],
            },
        },
        volumeClaimTemplates: [{
            metadata: {
                name: "mongo-data",
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                    requests: {
                        storage: "2Gi",
                    },
                },
            },
        }],
    },
}, { provider: k8sProvider });

const go_demo_5DbService = new k8s.core.v1.Service("go_demo_5DbService", {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
        name: "db",
        namespace: "go-demo-5",
    },
    spec: {
        ports: [{
            port: 27017,
        }],
        clusterIP: "None",
        selector: {
            app: "db",
        },
    },
}, { provider: k8sProvider });

const go_demo_5DbHorizontalPodAutoscaler = new k8s.autoscaling.v2beta1.HorizontalPodAutoscaler("go_demo_5DbHorizontalPodAutoscaler", {
    apiVersion: "autoscaling/v2beta1",
    kind: "HorizontalPodAutoscaler",
    metadata: {
        name: "db",
        namespace: "go-demo-5",
    },
    spec: {
        scaleTargetRef: {
            apiVersion: "apps/v1",
            kind: "StatefulSet",
            name: "db",
        },
        minReplicas: 3,
        maxReplicas: 5,
        metrics: [
            {
                type: "Resource",
                resource: {
                    name: "cpu",
                    targetAverageUtilization: 80,
                },
            },
            {
                type: "Resource",
                resource: {
                    name: "memory",
                    targetAverageUtilization: 80,
                },
            },
        ],
    },
}, { provider: k8sProvider });

const go_demo_5ApiDeployment = new k8s.apps.v1.Deployment("go_demo_5ApiDeployment", {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
        name: "api",
        namespace: "go-demo-5",
    },
    spec: {
        selector: {
            matchLabels: {
                app: "api",
            },
        },
        template: {
            metadata: {
                labels: {
                    app: "api",
                },
            },
            spec: {
                containers: [{
                    name: "api",
                    image: "vfarcic/go-demo-5",
                    env: [{
                        name: "DB",
                        value: "db",
                    }],
                    readinessProbe: {
                        httpGet: {
                            path: "/demo/hello",
                            port: 8080,
                        },
                        periodSeconds: 1,
                    },
                    livenessProbe: {
                        httpGet: {
                            path: "/demo/hello",
                            port: 8080,
                        },
                    },
                    resources: {
                        limits: {
                            memory: "1Gi",
                            cpu: "0.1",
                        },
                        requests: {
                            memory: "500Mi",
                            cpu: "0.01",
                        },
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider });

const go_demo_5ApiService = new k8s.core.v1.Service("go_demo_5ApiService", {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
        name: "api",
        namespace: "go-demo-5",
    },
    spec: {
        ports: [{
            port: 8080,
        }],
        selector: {
            app: "api",
        },
    },
}, { provider: k8sProvider });

const go_demo_5ApiHorizontalPodAutoscaler = new k8s.autoscaling.v2beta1.HorizontalPodAutoscaler("go_demo_5ApiHorizontalPodAutoscaler", {
    apiVersion: "autoscaling/v2beta1",
    kind: "HorizontalPodAutoscaler",
    metadata: {
        name: "api",
        namespace: "go-demo-5",
    },
    spec: {
        scaleTargetRef: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: "api",
        },
        minReplicas: 3,
        maxReplicas: 8,
        metrics: [
            {
                type: "Resource",
                resource: {
                    name: "cpu",
                    targetAverageUtilization: 80,
                },
            },
            {
                type: "Resource",
                resource: {
                    name: "memory",
                    targetAverageUtilization: 80,
                },
            },
        ],
    },
}, { provider: k8sProvider });